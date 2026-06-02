from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import uvicorn

app = FastAPI(title="FastAPI Blog API", version="1.0.0")

# 資料模型
class BlogPost(BaseModel):
    id: Optional[int] = None
    title: str
    content: str
    author: str
    created_at: Optional[datetime] = None

# 模擬資料庫
posts_db: List[BlogPost] = []
next_id = 1

# 取得所有文章
@app.get("/posts", response_model=List[BlogPost])
async def get_posts():
    return posts_db

# 取得單篇文章
@app.get("/posts/{post_id}", response_model=BlogPost)
async def get_post(post_id: int):
    for post in posts_db:
        if post.id == post_id:
            return post
    raise HTTPException(status_code=404, detail="Post not found")

# 建立新文章
@app.post("/posts", response_model=BlogPost)
async def create_post(post: BlogPost):
    global next_id
    new_post = BlogPost(
        id=next_id,
        title=post.title,
        content=post.content,
        author=post.author,
        created_at=datetime.now()
    )
    posts_db.append(new_post)
    next_id += 1
    return new_post

# 更新文章
@app.put("/posts/{post_id}", response_model=BlogPost)
async def update_post(post_id: int, post: BlogPost):
    for i, p in enumerate(posts_db):
        if p.id == post_id:
            posts_db[i] = BlogPost(
                id=post_id,
                title=post.title,
                content=post.content,
                author=post.author,
                created_at=p.created_at
            )
            return posts_db[i]
    raise HTTPException(status_code=404, detail="Post not found")

# 刪除文章
@app.delete("/posts/{post_id}")
async def delete_post(post_id: int):
    for i, post in enumerate(posts_db):
        if post.id == post_id:
            posts_db.pop(i)
            return {"message": "Post deleted successfully"}
    raise HTTPException(status_code=404, detail="Post not found")

# 根路由
@app.get("/")
async def root():
    return {"message": "Welcome to FastAPI Blog API", "docs": "/docs"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
