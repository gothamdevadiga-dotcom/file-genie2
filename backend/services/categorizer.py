import re

# How much text to look at per file (the start of a document says most about it).
SAMPLE_CHARS = 60_000
# One word repeated hundreds of times shouldn't win on its own.
MAX_COUNT_PER_KEYWORD = 5
# Below this score, there isn't enough evidence to pick a category.
MIN_SCORE = 6

# Each category maps telltale words/phrases to a weight (higher = stronger signal).
CATEGORIES = {
    "Programming": {
        "printf": 3, "scanf": 3, "#include": 3, "int main": 3, "pointer": 2,
        "pointers": 2, "array": 1, "arrays": 1, "loop": 1, "loops": 1,
        "compiler": 2, "compilation": 2, "syntax": 1, "variable": 1,
        "variables": 1, "data types": 2, "operators": 1, "python": 2,
        "java": 2, "javascript": 2, "c language": 2, "if else": 2,
        "while loop": 2, "for loop": 2, "debugging": 2, "source code": 2,
        "function": 1, "functions": 1, "programming": 2,
    },
    "DSA": {
        "linked list": 4, "stack": 2, "queue": 2, "binary tree": 4,
        "binary search": 4, "sorting": 2, "bubble sort": 4, "merge sort": 4,
        "quick sort": 4, "time complexity": 4, "space complexity": 3,
        "big o": 3, "hash table": 4, "heap": 2, "recursion": 2,
        "dynamic programming": 4, "traversal": 3, "bfs": 3, "dfs": 3,
        "adjacency": 3, "graph": 1,
    },
    "AI/ML": {
        "machine learning": 4, "neural network": 4, "neural networks": 4,
        "deep learning": 4, "gradient descent": 4, "backpropagation": 4,
        "training data": 3, "dataset": 2, "classification": 2, "regression": 2,
        "overfitting": 3, "supervised": 3, "unsupervised": 3,
        "artificial intelligence": 4, "tensorflow": 3, "pytorch": 3,
        "clustering": 3, "nlp": 3, "transformer": 2, "embedding": 2,
        "model": 1, "accuracy": 1,
    },
    "Physics": {
        "velocity": 2, "acceleration": 2, "momentum": 3, "newton": 2,
        "gravity": 3, "gravitational": 3, "force": 1, "energy": 1,
        "quantum": 3, "wavelength": 3, "photon": 3, "thermodynamics": 4,
        "entropy": 3, "electric field": 3, "magnetic field": 3, "fermi": 4,
        "kinetic": 2, "potential energy": 3, "relativity": 3, "optics": 3,
        "refraction": 3, "wave": 1,
    },
    "Electronics": {
        "diode": 4, "forward bias": 4, "reverse bias": 4, "transistor": 4,
        "amplifier": 3, "semiconductor": 3, "pn junction": 4, "rectifier": 3,
        "resistor": 3, "capacitor": 3, "inductor": 3, "circuit": 2,
        "op-amp": 3, "oscillator": 3, "mosfet": 4, "bjt": 4,
        "logic gate": 3, "flip flop": 3, "voltage": 1,
    },
    "Chemistry": {
        "molecule": 3, "molecules": 3, "chemical reaction": 4, "acid": 2,
        "periodic table": 4, "covalent": 4, "ionic": 3, "organic chemistry": 4,
        "oxidation": 3, "electron configuration": 3, "molar": 3,
        "compound": 2, "catalyst": 3, "equilibrium": 2, "alkane": 4,
        "alkene": 4, "titration": 4, "stoichiometry": 4, "bond": 1,
    },
    "Mathematics": {
        "theorem": 3, "proof": 2, "derivative": 3, "integral": 3,
        "calculus": 4, "matrix": 2, "matrices": 3, "eigenvalue": 4,
        "vector": 1, "differential equation": 4, "differential equations": 4,
        "probability": 2, "algebra": 3, "trigonometry": 3, "laplace": 4,
        "fourier": 3, "linear algebra": 4, "determinant": 3,
        "permutation": 2, "limit": 1,
    },
    "English": {
        "grammar": 3, "tense": 3, "noun": 3, "verb": 3, "adjective": 3,
        "adverb": 3, "essay": 2, "vocabulary": 3, "comprehension": 3,
        "literature": 3, "poem": 2, "poetry": 3, "paragraph": 2,
        "synonym": 3, "antonym": 3, "preposition": 3,
        "communication skills": 3, "letter writing": 3, "shakespeare": 3,
        "sentence": 1,
    },
}


def _compile(keyword: str):
    # Match whole words/phrases only (so "heap" doesn't match "cheaper").
    return re.compile(r"(?<!\w)" + re.escape(keyword) + r"(?!\w)")


_COMPILED = {
    cat: {kw: (_compile(kw), weight) for kw, weight in kws.items()}
    for cat, kws in CATEGORIES.items()
}


def _level(confidence: int) -> str:
    if confidence >= 70:
        return "High"
    if confidence >= 45:
        return "Medium"
    return "Low"


def categorize(text: str) -> dict:
    """Pick a category from the file's text. Returns the category, a
    confidence estimate, and the evidence behind the decision."""
    sample = (text or "")[:SAMPLE_CHARS].lower()

    if not sample.strip():
        return {
            "category": None,
            "confidence": 0,
            "level": "None",
            "reason": "No readable text, so this file could not be categorized.",
            "candidates": [],
        }

    scores, evidence = {}, {}
    for cat, keywords in _COMPILED.items():
        total, hits = 0, []
        for kw, (pattern, weight) in keywords.items():
            count = len(pattern.findall(sample))
            if count:
                points = min(count, MAX_COUNT_PER_KEYWORD) * weight
                total += points
                hits.append((kw, count, points))
        scores[cat] = total
        hits.sort(key=lambda h: h[2], reverse=True)
        evidence[cat] = hits

    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    top_cat, top_score = ranked[0]
    second_cat, second_score = ranked[1]
    candidates = [{"category": c, "score": s} for c, s in ranked[:3] if s > 0]

    if top_score < MIN_SCORE:
        return {
            "category": "Uncategorized",
            "confidence": 0,
            "level": "None",
            "reason": "Not enough subject-specific words to choose a category.",
            "candidates": candidates,
        }

    # Confidence = how dominant the winner is, scaled by how much evidence exists.
    # It is an estimate, not a true probability.
    share = top_score / sum(scores.values())
    strength = min(1.0, top_score / 30)
    confidence = round(100 * (0.5 * share + 0.5 * strength))

    top_words = ", ".join(f"{kw} (x{n})" for kw, n, _ in evidence[top_cat][:5])
    reason = f"Matched {top_cat} terms: {top_words}."
    if second_score >= 0.8 * top_score:
        reason += f" Close call with {second_cat}."

    return {
        "category": top_cat,
        "confidence": confidence,
        "level": _level(confidence),
        "reason": reason,
        "candidates": candidates,
    }