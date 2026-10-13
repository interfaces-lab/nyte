#!/bin/sh
# Download the reference films, transcribe them and lay their frames out as
# contact sheets. Output stays in video/research, which git ignores.
set -eu
mkdir -p "$(dirname "$0")/../research"
cd "$(dirname "$0")/../research"

for url in \
  https://x.com/ivanhzhao/status/2038670159259619644 \
  https://x.com/rajzmotion/status/2109273645654888831; do
  yt-dlp -q --no-warnings --write-info-json -o "%(uploader_id)s.%(ext)s" "$url"
done

for film in ivanhzhao rajzmotion; do
  ffmpeg -v error -y -i "$film.mp4" -vn -ac 1 -ar 16000 "$film.wav"
  uvx --from mlx-whisper mlx_whisper "$film.wav" --model mlx-community/whisper-large-v3-turbo \
    --word-timestamps True --output-format all --output-dir . > /dev/null
done

# One frame every two seconds for the slow film, two a second for the fast one.
ffmpeg -v error -y -i ivanhzhao.mp4 -vf "fps=1/2,scale=384:-1,tile=6x4" ivanhzhao_%02d.jpg
ffmpeg -v error -y -i rajzmotion.mp4 -vf "fps=2,scale=384:-1,tile=6x5" rajzmotion_%02d.jpg
