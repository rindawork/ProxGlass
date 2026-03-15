# Production Stage
FROM python:3.11-slim-bookworm

# Set work directory
WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1
ENV PROXGLASS_DB_FILE /app/data/app.db
ENV PROXGLASS_PORT 9000

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Create data directory for persistence
RUN mkdir -p /app/data && chmod 777 /app/data

# Run the application
EXPOSE 9000
CMD ["python", "main.py"]
