from dataclasses import dataclass
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


NOSE = 0
LEFT_EYE = 2
RIGHT_EYE = 5
LEFT_EAR = 7
RIGHT_EAR = 8
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW = 13
RIGHT_ELBOW = 14
LEFT_WRIST = 15
RIGHT_WRIST = 16


@dataclass(frozen=True)
class Classification:
    label: str
    confidence: float
    reasons: list[str]
    detected: bool = True


class PoseClassifier:
    def __init__(self, model_path: Path):
        if not model_path.exists():
            raise FileNotFoundError(f"Model MediaPipe tidak ditemukan: {model_path}")

        base_options = python.BaseOptions(model_asset_path=str(model_path))
        options = vision.PoseLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._detector = vision.PoseLandmarker.create_from_options(options)

    def classify_frame(self, frame: np.ndarray) -> Classification:
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        result = self._detector.detect(mp_image)

        if not result.pose_landmarks:
            return Classification(
                label="normal",
                confidence=0.0,
                reasons=["Pose/wajah belum terdeteksi"],
                detected=False,
            )

        return classify_landmarks(result.pose_landmarks[0])


def classify_landmarks(landmarks) -> Classification:
    nose = _landmark_xy(landmarks, NOSE)
    left_eye = _landmark_xy(landmarks, LEFT_EYE)
    right_eye = _landmark_xy(landmarks, RIGHT_EYE)
    left_shoulder = _landmark_xy(landmarks, LEFT_SHOULDER)
    right_shoulder = _landmark_xy(landmarks, RIGHT_SHOULDER)
    left_elbow = _landmark_xy(landmarks, LEFT_ELBOW)
    right_elbow = _landmark_xy(landmarks, RIGHT_ELBOW)
    left_wrist = _landmark_xy(landmarks, LEFT_WRIST)
    right_wrist = _landmark_xy(landmarks, RIGHT_WRIST)

    shoulder_width = max(_distance(left_shoulder, right_shoulder), 0.001)
    shoulder_center = (left_shoulder + right_shoulder) / 2
    eye_center = (left_eye + right_eye) / 2
    eye_width = max(_distance(left_eye, right_eye), 0.001)

    face_center_offset = abs(float(nose[0] - shoulder_center[0])) / shoulder_width
    nose_eye_offset = abs(float(nose[0] - eye_center[0])) / eye_width
    eye_to_nose_drop = float(nose[1] - eye_center[1])
    nose_to_shoulder_drop = float(shoulder_center[1] - nose[1])
    head_drop_ratio = nose_to_shoulder_drop / shoulder_width
    ear_visibility_gap = abs(landmarks[LEFT_EAR].visibility - landmarks[RIGHT_EAR].visibility)
    hand_to_face = min(_distance(left_wrist, nose), _distance(right_wrist, nose)) / shoulder_width
    hand_to_chest = min(
        _distance(left_wrist, shoulder_center),
        _distance(right_wrist, shoulder_center),
    ) / shoulder_width
    elbow_to_chest = min(
        _distance(left_elbow, shoulder_center),
        _distance(right_elbow, shoulder_center),
    ) / shoulder_width
    hand_between_shoulders = (
        min(left_shoulder[0], right_shoulder[0]) - shoulder_width * 0.25
        <= min(left_wrist[0], right_wrist[0])
        <= max(left_shoulder[0], right_shoulder[0]) + shoulder_width * 0.25
    )
    hand_in_upper_body = min(left_wrist[1], right_wrist[1]) <= shoulder_center[1] + shoulder_width * 0.95

    scores = {
        "normal": 0.58,
        "mobile-use": 0.0,
        "side-watching": 0.0,
        "nunduk": 0.0,
    }
    reasons = []

    mobile_score = max(
        _score_range(0.98 - hand_to_face, start=0.0, end=0.5),
        _score_range(0.9 - hand_to_chest, start=0.0, end=0.52),
        _score_range(0.85 - elbow_to_chest, start=0.0, end=0.5),
    )
    if mobile_score > 0 or (hand_between_shoulders and hand_in_upper_body):
        scores["mobile-use"] = max(0.82, min(0.98, mobile_score))
        reasons.append("Tangan berada di area penggunaan HP")

    side_score = max(
        _score_range(face_center_offset, start=0.16, end=0.42),
        _score_range(nose_eye_offset, start=0.18, end=0.55),
        _score_range(ear_visibility_gap, start=0.22, end=0.62),
    )
    if side_score > 0:
        scores["side-watching"] = max(0.66, min(0.96, side_score))
        reasons.append("Wajah terlihat mengarah ke samping")

    nunduk_score = max(
        _score_range(eye_to_nose_drop, start=0.055, end=0.14),
        _score_range(0.72 - head_drop_ratio, start=0.0, end=0.32),
    )
    if eye_to_nose_drop > 0.05 and head_drop_ratio < 0.72:
        scores["nunduk"] = max(
            0.68,
            min(0.96, nunduk_score),
        )
        reasons.append("Kepala cenderung turun")

    label = max(scores, key=scores.get)
    if label == "normal":
        reasons.append("Postur terdeteksi normal")

    return Classification(
        label=label,
        confidence=round(float(scores[label]), 3),
        reasons=reasons,
    )


def _landmark_xy(landmarks, index: int) -> np.ndarray:
    point = landmarks[index]
    return np.array([point.x, point.y], dtype=np.float32)


def _distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a - b))


def _score_range(value: float, start: float, end: float) -> float:
    if value <= start:
        return 0.0
    if value >= end:
        return 1.0
    return (value - start) / (end - start)
