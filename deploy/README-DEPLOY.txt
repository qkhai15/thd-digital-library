MỤC TIÊU
========
Deploy website Next.js + PostgreSQL + upload file lên VPS Ubuntu và chạy tại:
https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn/

BẠN CẦN
=======
1. VPS Ubuntu có IP public.
2. Quyền quản lý DNS của domain tranhungdaothanhxuan-hanoi.edu.vn.
3. Project C:\Projects\thd-library hiện tại.

BƯỚC 1 - GHÉP THƯ MỤC deploy
=============================
Copy thư mục "deploy" trong gói này vào gốc project:

C:\Projects\thd-library\deploy

BƯỚC 2 - DNS
============
Tại nơi quản lý domain tạo:

Type: A
Name/Host: thuvien
Value: IP_PUBLIC_CUA_VPS
TTL: Auto hoặc 300

Sau khi tạo, trên Windows có thể kiểm tra:
nslookup thuvien.tranhungdaothanhxuan-hanoi.edu.vn

Kết quả phải trả về đúng IP VPS.

BƯỚC 3 - CÀI DOCKER TRÊN VPS
==============================
SSH vào VPS rồi chạy:

sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc > /dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker

Mở firewall:
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

BƯỚC 4 - COPY PROJECT LÊN VPS
==============================
Từ Windows PowerShell:

cd C:\Projects
scp -r .\thd-library root@IP_VPS:/opt/

Nếu VPS không dùng root, thay root bằng user VPS.

BƯỚC 5 - TẠO ENV PRODUCTION
============================
SSH vào VPS:

ssh root@IP_VPS

Sau đó:

cd /opt/thd-library/deploy
cp .env.production.example .env.production
nano .env.production

Đổi 3 giá trị:
POSTGRES_PASSWORD
ADMIN_PASSWORD
SESSION_SECRET

Lưu nano:
Ctrl+O
Enter
Ctrl+X

BƯỚC 6 - DEPLOY
================
cd /opt/thd-library/deploy
chmod +x deploy.sh
./deploy.sh

BƯỚC 7 - KIỂM TRA
==================
docker compose --env-file .env.production -f docker-compose.prod.yml ps

Log website:
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app

Log HTTPS/domain:
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f caddy

Mở:
https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn/

Admin:
https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn/admin

UPLOAD
======
File người dùng upload được lưu bền tại:
deploy/data/uploads

DATABASE
========
PostgreSQL nằm trong Docker volume:
postgres_data

UPDATE CODE SAU NÀY
===================
Copy code mới lên VPS rồi chạy lại:
cd /opt/thd-library/deploy
./deploy.sh
