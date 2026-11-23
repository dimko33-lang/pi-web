FROM docker.io/library/python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
ENV PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 MPLBACKEND=Agg OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
COPY requirements.lock /tmp/science-requirements.lock
RUN pip install --no-cache-dir -r /tmp/science-requirements.lock && pip freeze > /opt/science-packages.txt
USER 65534:65534
WORKDIR /work
CMD ["python3", "-I", "-u", "-"]
