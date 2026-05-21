# GCP Windows VM startup script
# Runs automatically on boot via instance metadata startup-script-windows
# Installs Python dependencies and starts the FastAPI agent on port 8765

$AgentDir = "C:\xactdraft-agent"
$PythonPath = "C:\Python311\python.exe"

# Copy agent files from GCS (bucket/path set via VM metadata)
$Bucket = (Invoke-RestMethod -Headers @{"Metadata-Flavor"="Google"} `
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/agent-bucket")
gsutil -m cp gs://$Bucket/vm-agent/* $AgentDir\

# Install dependencies
& $PythonPath -m pip install -r $AgentDir\requirements.txt --quiet

# Start agent (background, restart on failure)
Start-Process -FilePath $PythonPath `
  -ArgumentList "-m uvicorn agent:app --host 0.0.0.0 --port 8765" `
  -WorkingDirectory $AgentDir `
  -WindowStyle Hidden
