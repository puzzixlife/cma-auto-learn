#!/bin/bash
# 推送到 GitHub - 使用前请先在 GitHub 上创建空仓库
# 用法: bash setup-github.sh <your-username> <repo-name>

USERNAME=${1:-"your-username"}
REPO=${2:-"cma-auto-learn"}

echo "📦 准备推送到 GitHub..."
echo "   用户: $USERNAME"
echo "   仓库: $REPO"
echo ""

# 添加远程仓库
git remote remove origin 2>/dev/null
git remote add origin "https://github.com/$USERNAME/$REPO.git"

# 推送
echo "🚀 推送到 GitHub..."
git branch -M main
git push -u origin main

echo ""
echo "✅ 完成！"
echo "📎 仓库地址: https://github.com/$USERNAME/$REPO"
echo "📎 Raw 脚本: https://raw.githubusercontent.com/$USERNAME/$REPO/main/cma-auto-learn.user.js"
echo ""
echo "💡 Tampermonkey 安装链接:"
echo "   https://raw.githubusercontent.com/$USERNAME/$REPO/main/cma-auto-learn.user.js"
