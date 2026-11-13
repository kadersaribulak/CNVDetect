FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# main.py, genes_db.json, cnv_anotation.sh and, if present, the local panel BED (targets_merged.bed)
COPY . .
EXPOSE 8765
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765"]
