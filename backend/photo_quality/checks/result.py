def check_result(id, status, score=None, value=None, hint=None, details=None):
    return {"id": id, "status": status, "score": score, "value": value, "hint": hint, "details": details or {}}
