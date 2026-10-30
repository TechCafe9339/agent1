import os
from django.core.asgi import get_asgi_application
import socketio

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django_app = get_asgi_application()

from realtime import sio
application = socketio.ASGIApp(sio, django_app)