from sqlalchemy.orm import declarative_base

# 所有 app/models/ 中的类都要继承这个 Base
Base = declarative_base()