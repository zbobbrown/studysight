"""
train_model.py
Loads labeled CSVs from training-data/, trains a Random Forest classifier,
prints a cross-validation accuracy report, and saves the model to focus_model.pkl.

Usage:
    python train_model.py
"""

import warnings
warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")

import pathlib
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.preprocessing import LabelEncoder

TRAINING_DATA_DIR = pathlib.Path(__file__).parent / "training-data"
MODEL_PATH        = pathlib.Path(__file__).parent / "focus_model.pkl"

FEATURES = ["gaze_std", "head_var", "blink_rate", "pitch", "yaw"]

LABEL_MAP = {
    "on_task_computer":         1,
    "on_task_paper":            1,
    "on_task_computer+paper":   1,
    "off_task_computer":        0,
    "off_task_no_computer":     0,
}

def load_data():
    frames = []
    for path in sorted(TRAINING_DATA_DIR.glob("*.csv")):
        try:
            df = pd.read_csv(path)
        except pd.errors.EmptyDataError:
            print(f"  [skip] {path.name} — empty file")
            continue
        if df.empty:
            print(f"  [skip] {path.name} — no rows")
            continue
        print(f"  [load] {path.name} — {len(df):,} rows, label={df['label'].iloc[0]}")
        frames.append(df)

    if not frames:
        raise RuntimeError("No data found in training-data/")

    data = pd.concat(frames, ignore_index=True)

    # Map labels to binary
    data["target"] = data["label"].map(LABEL_MAP)
    unmapped = data["target"].isna().sum()
    if unmapped:
        unknown = data.loc[data["target"].isna(), "label"].unique()
        raise ValueError(f"Unknown labels (not in LABEL_MAP): {unknown}")

    data["target"] = data["target"].astype(int)
    return data

def main():
    print("\n── Loading data ──────────────────────────────────────────")
    data = load_data()

    X = data[FEATURES].values
    y = data["target"].values

    total    = len(y)
    focused  = y.sum()
    distract = total - focused
    print(f"\nTotal rows : {total:,}")
    print(f"Focused    : {focused:,}  ({100*focused/total:.1f}%)")
    print(f"Distracted : {distract:,}  ({100*distract/total:.1f}%)")

    # ── Cross-validation ───────────────────────────────────────────────────────
    # Note: consecutive frames are correlated, so CV scores are optimistic.
    # The real test is performance on new sessions (run more labeled sessions).
    print("\n── Cross-validation (5-fold stratified) ──────────────────")
    clf_cv = RandomForestClassifier(
        n_estimators=200,
        max_depth=10,
        min_samples_leaf=20,
        n_jobs=-1,
        random_state=42,
    )
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    scores = cross_val_score(clf_cv, X, y, cv=cv, scoring="accuracy")
    print(f"Fold accuracies: {[f'{s:.3f}' for s in scores]}")
    print(f"Mean ± std     : {scores.mean():.3f} ± {scores.std():.3f}")

    # ── Hold-out test set ──────────────────────────────────────────────────────
    # Stratify by (label × file) to ensure each class has test examples.
    print("\n── Hold-out evaluation (20% test split) ──────────────────")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    clf_cv.fit(X_train, y_train)
    y_pred = clf_cv.predict(X_test)
    print(classification_report(y_test, y_pred, target_names=["distracted", "focused"]))
    print("Confusion matrix (rows=actual, cols=predicted):")
    print(f"  {'':12s}  dist  focus")
    cm = confusion_matrix(y_test, y_pred)
    print(f"  {'distracted':12s}  {cm[0,0]:5d}  {cm[0,1]:5d}")
    print(f"  {'focused':12s}  {cm[1,0]:5d}  {cm[1,1]:5d}")

    # ── Feature importance ─────────────────────────────────────────────────────
    print("\n── Feature importance ────────────────────────────────────")
    for feat, imp in sorted(zip(FEATURES, clf_cv.feature_importances_),
                            key=lambda x: -x[1]):
        bar = "█" * int(imp * 40)
        print(f"  {feat:12s}  {imp:.4f}  {bar}")

    # ── Train final model on all data ──────────────────────────────────────────
    print("\n── Training final model on all data ──────────────────────")
    clf_final = RandomForestClassifier(
        n_estimators=200,
        max_depth=10,
        min_samples_leaf=20,
        n_jobs=-1,
        random_state=42,
    )
    clf_final.fit(X, y)
    joblib.dump(clf_final, MODEL_PATH)
    print(f"Saved → {MODEL_PATH}")
    print(f"Model classes: {clf_final.classes_}  (0=distracted, 1=focused)")

if __name__ == "__main__":
    main()
