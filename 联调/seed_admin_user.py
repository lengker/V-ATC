"""
在 A5 SQLite 中创建或更新默认管理员账号。

用法（A5 未启动也可执行，直接写 backend/data.sqlite3）:
  cd 联调
  python seed_admin_user.py

默认: 用户名 admin · 密码 123456 · 角色 admin
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.api.auth import _hash_password  # noqa: E402
from app.db.bootstrap import initialize_database  # noqa: E402
from app.db.connection import get_connection  # noqa: E402

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "123456"
ADMIN_ROLE = "admin"
ADMIN_EMAIL = "admin@alpha.local"


def main() -> None:
    password_hash = _hash_password(ADMIN_PASSWORD)
    with get_connection() as conn:
        initialize_database(conn)
        row = conn.execute(
            "SELECT user_id, role FROM LNG_USERS WHERE username = ? COLLATE NOCASE",
            (ADMIN_USERNAME,),
        ).fetchone()
        if row:
            conn.execute(
                """
                UPDATE LNG_USERS
                SET password_hash = ?, role = ?, email = ?
                WHERE user_id = ?
                """,
                (password_hash, ADMIN_ROLE, ADMIN_EMAIL, int(row["user_id"])),
            )
            print(
                f"[OK] 已更新管理员 user_id={row['user_id']} "
                f"username={ADMIN_USERNAME} role={ADMIN_ROLE}"
            )
        else:
            cur = conn.execute(
                """
                INSERT INTO LNG_USERS (username, password_hash, role, email)
                VALUES (?, ?, ?, ?)
                """,
                (ADMIN_USERNAME, password_hash, ADMIN_ROLE, ADMIN_EMAIL),
            )
            print(
                f"[OK] 已创建管理员 user_id={cur.lastrowid} "
                f"username={ADMIN_USERNAME} role={ADMIN_ROLE}"
            )
    print(f"     登录: 用户名 {ADMIN_USERNAME} · 密码 {ADMIN_PASSWORD}")
    print("     登录页请输入用户名（不要用邮箱别名）。")


if __name__ == "__main__":
    main()
