import os

from flask import Flask, jsonify, render_template, request

from pose_app.config import HOST, MODEL_PATH, MPL_CONFIG_DIR, PORT
from pose_app.image import decode_data_url


MPL_CONFIG_DIR.mkdir(exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(MPL_CONFIG_DIR))

from pose_app.classifier import PoseClassifier

app = Flask(__name__)
classifier = PoseClassifier(MODEL_PATH)


@app.get("/")
def home():
    return render_template("index.html")


@app.post("/predict")
def predict():
    payload = request.get_json(silent=True) or {}
    image = payload.get("image")
    if not image:
        return jsonify({"error": "Image frame kosong"}), 400

    try:
        frame = decode_data_url(image)
        classification = classifier.classify_frame(frame)
        return jsonify({
            "label": classification.label,
            "confidence": classification.confidence,
            "reasons": classification.reasons,
            "detected": classification.detected,
        })
    except Exception as error:
        return jsonify({"error": str(error)}), 500


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=False)
