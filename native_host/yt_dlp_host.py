import sys
import struct
import json
import subprocess
import os
import re
import shutil
import tempfile

if sys.platform == 'win32':
    import msvcrt
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)

_YT_DLP_CMD = None


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    message_length = struct.unpack('=I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)


def send_message(message):
    encoded = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('=I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def get_yt_dlp_cmd():
    global _YT_DLP_CMD
    if _YT_DLP_CMD is not None:
        return _YT_DLP_CMD
    try:
        probe = subprocess.run(['yt-dlp', '--version'], capture_output=True, timeout=15)
        if probe.returncode == 0:
            _YT_DLP_CMD = ['yt-dlp']
            return _YT_DLP_CMD
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    scripts_dir = os.path.join(os.path.dirname(sys.executable), 'Scripts')
    for name in ('yt-dlp.exe', 'yt-dlp'):
        candidate = os.path.join(scripts_dir, name)
        if os.path.exists(candidate):
            _YT_DLP_CMD = [candidate]
            return _YT_DLP_CMD
    # Fallback: invoke yt-dlp as a Python module
    try:
        check = subprocess.run([sys.executable, '-m', 'yt_dlp', '--version'], capture_output=True, timeout=15)
        if check.returncode == 0:
            _YT_DLP_CMD = [sys.executable, '-m', 'yt_dlp']
            return _YT_DLP_CMD
    except subprocess.TimeoutExpired:
        pass
    _YT_DLP_CMD = ['yt-dlp']
    return _YT_DLP_CMD


def sanitize_filename(name):
    cleaned = re.sub(r'[\\/:*?"<>|]', '', name or '').strip().strip('.')
    return cleaned[:80] or 'download'


def write_cookies_file(cookies):
    if not cookies:
        return None
    fd, path = tempfile.mkstemp(prefix='yt_dlp_cookies_', suffix='.txt')
    with os.fdopen(fd, 'w', encoding='utf-8', newline='') as f:
        f.write(cookies)
    return path


def extract_with_yt_dlp(url, cookies=''):
    cmd = get_yt_dlp_cmd() + ['--dump-json', '--no-playlist', '--no-warnings', '--no-check-certificates']
    cookies_path = write_cookies_file(cookies)
    try:
        if cookies_path:
            cmd += ['--cookies', cookies_path]
        cmd.append(url)
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=False)

        if result.returncode != 0:
            error_msg = result.stderr.strip() or result.stdout.strip()
            return {'error': f'yt-dlp failed: {error_msg[:200]}'}

        raw = result.stdout.strip()
        if not raw:
            return {'error': 'No output from yt-dlp'}

        try:
            best = json.loads(raw)
        except json.JSONDecodeError:
            best = None
            for line in raw.split('\n'):
                try:
                    best = json.loads(line)
                    break
                except json.JSONDecodeError:
                    continue
        if not isinstance(best, dict):
            return {'error': 'Could not parse yt-dlp output'}

        formats = best.get('formats') or []

        video_formats = [f for f in formats if f.get('url') and f.get('vcodec') not in (None, 'none')]
        audio_formats = [f for f in formats if f.get('url') and f.get('acodec') not in (None, 'none') and f.get('vcodec') in (None, 'none')]
        if not audio_formats:
            audio_formats = [f for f in formats if f.get('url') and f.get('acodec') not in (None, 'none')]

        video_formats.sort(key=lambda f: (f.get('height') or 0, f.get('tbr') or 0), reverse=True)
        audio_formats.sort(key=lambda f: f.get('abr') or 0, reverse=True)

        quality_options = []
        for vf in video_formats:
            label = f"{vf.get('height', '?')}p"
            if vf.get('ext'):
                label += f" ({vf['ext']})"
            if vf.get('tbr'):
                label += f" {vf['tbr']:.0f}kbps"
            quality_options.append({
                'label': label,
                'id': vf.get('format_id'),
                'url': vf.get('url'),
                'height': vf.get('height'),
                'ext': vf.get('ext', 'mp4'),
            })

        audio_options = []
        for af in audio_formats:
            label = f"{af.get('abr', '?')}kbps ({af.get('ext', '?')})" if af.get('abr') else f"audio ({af.get('ext', '?')})"
            audio_options.append({
                'label': label,
                'id': af.get('format_id'),
                'url': af.get('url'),
                'abr': af.get('abr'),
                'ext': af.get('ext', 'mp3'),
            })

        if not quality_options and not audio_options:
            return {'error': 'No downloadable media found'}

        progressive = [f for f in video_formats if f.get('acodec') not in (None, 'none')]
        best_video = progressive[0] if progressive else (video_formats[0] if video_formats else None)
        thumbnail = best.get('thumbnail') or None
        title = best.get('title') or 'Media'
        ext = (best_video or {}).get('ext', 'mp4')
        filename = f"{sanitize_filename(title)}.{ext}"

        return {
            'videoUrl': best_video.get('url') if best_video else None,
            'audioUrl': audio_formats[0].get('url') if audio_formats else None,
            'thumbnail': thumbnail,
            'filename': filename,
            'title': title,
            'duration': best.get('duration'),
            'quality': f"{best_video.get('height', '?')}p" if best_video and best_video.get('height') else 'Best',
            'isVideo': bool(video_formats),
            'formats': quality_options,
            'audioFormats': audio_options,
        }
    except subprocess.TimeoutExpired:
        return {'error': 'yt-dlp timed out (60s). Try a shorter video or try again.'}
    except Exception as e:
        return {'error': f'Unexpected error: {str(e)[:200]}'}
    finally:
        if cookies_path:
            try:
                os.unlink(cookies_path)
            except OSError:
                pass


def download_with_yt_dlp(url, format_choice='mp4', format_id=None, title=None, cookies=''):
    ffmpeg = shutil.which('ffmpeg')
    downloads_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
    try:
        os.makedirs(downloads_dir, exist_ok=True)
    except OSError:
        pass

    safe_title = sanitize_filename(title)
    outtmpl = os.path.join(downloads_dir, safe_title + '.%(ext)s')

    cmd = get_yt_dlp_cmd() + ['--no-warnings', '--no-playlist', '--no-check-certificates', '-o', outtmpl]
    cookies_path = write_cookies_file(cookies)
    note = None
    try:
        if cookies_path:
            cmd += ['--cookies', cookies_path]

        if format_choice == 'mp3':
            if ffmpeg:
                cmd += ['-x', '--audio-format', 'mp3']
                format_sel = f'{format_id}/bestaudio/best' if format_id else 'bestaudio/best'
            else:
                format_sel = format_id or 'bestaudio/best'
                note = 'ffmpeg not found: downloaded best audio in its original format (rename or convert externally for MP3).'
        else:
            if ffmpeg:
                format_sel = f'{format_id}+bestaudio/best' if format_id else 'bestvideo[ext=mp4]+bestaudio/best/best[ext=mp4]/best'
            else:
                format_sel = format_id or 'best[ext=mp4]/best'
                if format_id is None:
                    note = 'ffmpeg not found: falling back to best progressive (single-file) format.'

        cmd += ['-f', format_sel, '--print', 'after_move:filepath', url]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600, check=False)

        if result.returncode != 0:
            error_msg = result.stderr.strip() or result.stdout.strip()
            return {'error': f'yt-dlp download failed: {error_msg[:300]}'}

        path = None
        for line in result.stdout.strip().split('\n'):
            line = line.strip()
            if line:
                path = line

        return {'success': True, 'path': path, 'note': note}
    except subprocess.TimeoutExpired:
        return {'error': 'Download timed out (10 min). Try a shorter video.'}
    except Exception as e:
        return {'error': f'Unexpected error: {str(e)[:200]}'}
    finally:
        if cookies_path:
            try:
                os.unlink(cookies_path)
            except OSError:
                pass


def main():
    while True:
        try:
            message = read_message()
        except Exception as e:
            try:
                send_message({'error': f'Native host error: {str(e)[:200]}'})
            except Exception:
                pass
            return

        if message is None:
            return

        try:
            action = message.get('action', 'extract')
            url = message.get('url', '')
            cookies = message.get('cookies', '')

            if not url:
                send_message({'error': 'No URL provided'})
                continue

            if action == 'download':
                result = download_with_yt_dlp(
                    url,
                    format_choice=message.get('format', 'mp4'),
                    format_id=message.get('format_id'),
                    title=message.get('title'),
                    cookies=cookies,
                )
            else:
                result = extract_with_yt_dlp(url, cookies=cookies)
            send_message(result)
        except Exception as e:
            try:
                send_message({'error': f'Native host error: {str(e)[:200]}'})
            except Exception:
                pass


if __name__ == '__main__':
    main()
