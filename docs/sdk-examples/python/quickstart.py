"""Submit a task with a Stellar service account and wait for its result."""

import argparse
import base64
import json
import os
import time
from urllib.parse import quote
from uuid import uuid4

import requests
from stellar_sdk import Keypair


def request(session, method, url, **kwargs):
    for attempt in range(5):
        response = session.request(method, url, timeout=15, **kwargs)
        if response.status_code != 429 or attempt == 4:
            return response
        delay = response.headers.get("Retry-After", "")
        time.sleep(max(2**attempt, int(delay)) if delay.isdecimal() else 2**attempt)
    raise AssertionError("unreachable")


def checked(response):
    if response.ok:
        return response.json()
    try:
        error = response.json()
    except ValueError:
        error = {}
    detail = error.get("error", error)
    code = detail.get("code") if isinstance(detail, dict) else None
    messages = {
        400: "Check the request fields and API version",
        401: "Authenticate again with a fresh challenge",
        403: "Check that this wallet owns the task",
        429: "Request quota exhausted",
    }
    message = messages.get(
        response.status_code,
        "Service unavailable" if response.status_code >= 500 else "Request failed",
    )
    raise RuntimeError(f"{message} (HTTP {response.status_code}, {code or 'no code'})")


def authenticate(session, base, wallet):
    response = request(session, "GET", f"{base}/api/auth/challenge")
    if response.status_code == 404:
        response = request(session, "GET", f"{base}/api/auth/nonce")
    nonce = checked(response)["nonce"]
    signature = base64.b64encode(wallet.sign(nonce.encode("utf-8"))).decode("ascii")
    tokens = checked(request(session, "POST", f"{base}/api/auth/token", json={
        "publicKey": wallet.public_key, "nonce": nonce,
        "signature": signature, "deviceId": "python-quickstart",
    }))
    return tokens["accessToken"]


def run(base, wallet, prompt):
    with requests.Session() as session:
        token = authenticate(session, base, wallet)

        def task_request(method, path, *, idempotency_key=None, **kwargs):
            nonlocal token

            def send():
                headers = {
                    "Authorization": f"Bearer {token}",
                    "API-Version": "1.0",
                }
                if idempotency_key:
                    headers["Idempotency-Key"] = idempotency_key
                return request(session, method, f"{base}{path}", headers=headers, **kwargs)

            response = send()
            if response.status_code == 401:
                token = authenticate(session, base, wallet)
                response = send()
            return response

        accepted = task_request("POST", "/api/tasks", idempotency_key=str(uuid4()), json={
            "prompt": prompt, "walletPublicKey": wallet.public_key,
            "priority": "normal", "maxBudgetXLM": 1, "agentPreferences": [],
        })
        task_id = checked(accepted)["taskId"]
        if accepted.status_code not in (201, 202):
            raise RuntimeError(f"Unexpected task submission HTTP {accepted.status_code}")

        path = f"/api/tasks/{quote(task_id, safe='')}"
        deadline = time.monotonic() + 300
        delay = 1
        while time.monotonic() < deadline:
            task = checked(task_request("GET", path))
            if task["status"] == "completed":
                return [
                    {"nodeId": node["nodeId"], "result": node["result"]}
                    for node in task["dag"] if "result" in node
                ]
            if task["status"] in {"failed", "cancelled"}:
                raise RuntimeError(f"Task {task_id} finished with status {task['status']}")
            time.sleep(delay)
            delay = min(delay * 2, 15)
        raise RuntimeError(f"Polling timed out for {task_id}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", default="Summarize how Stellar accounts work in one paragraph.")
    parser.add_argument("--generate-key", action="store_true", help="Use an ephemeral identity")
    args = parser.parse_args()
    secret = os.getenv("STELLAR_SECRET_KEY")
    if not args.generate_key and not secret:
        parser.error("set STELLAR_SECRET_KEY or pass --generate-key for a development identity")
    wallet = Keypair.random() if args.generate_key else Keypair.from_secret(secret)
    base = os.getenv("AI_NET_API_URL", "http://localhost:3001").rstrip("/")
    try:
        print(json.dumps(run(base, wallet, args.prompt), indent=2))
    except (requests.RequestException, RuntimeError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
