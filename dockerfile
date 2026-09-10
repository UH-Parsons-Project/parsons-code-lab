FROM node:20

WORKDIR /app

RUN apt-get update && apt-get install -y python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

COPY package*.json ./
COPY requirements.txt ./

RUN npm ci --no-audit --no-fund

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN npm run build

ENV PORT=8000
# Allow manual DB reset and seeding via /api/reset-db and /api/seed-db endpoints
ENV DEVELOPMENT_MODE=true
EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
