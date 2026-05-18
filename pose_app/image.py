import base64

import cv2
import numpy as np


def decode_data_url(data_url: str) -> np.ndarray:
    """Decode a browser data URL into an OpenCV BGR frame."""
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]

    image_bytes = base64.b64decode(data_url)
    image_buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(image_buffer, cv2.IMREAD_COLOR)

    if frame is None:
        raise ValueError("Frame kamera tidak valid")

    return frame
