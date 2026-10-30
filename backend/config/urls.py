from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path(
        "api/projects/",
        include("projects.urls"),
    ),
    path(
        "api/chat/",
        include("conversations.urls"),
    ),
    path(
        "api-auth/",
        include("rest_framework.urls"),
    ),
    path(
        "api/auth/",
        include("accounts.urls"),
    ),
]
