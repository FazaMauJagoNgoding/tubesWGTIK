from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = BASE_DIR / "pose_landmarker_lite.task"
MPL_CONFIG_DIR = BASE_DIR / ".mplconfig"

HOST = "127.0.0.1"
PORT = 5000
