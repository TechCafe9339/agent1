from django.contrib.auth import get_user_model

from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .serializers import RegisterSerializer


User = get_user_model()


@api_view(["POST"])
@permission_classes([AllowAny])
def register_view(request):
    serializer = RegisterSerializer(
        data=request.data
    )

    serializer.is_valid(
        raise_exception=True
    )

    user = serializer.save()

    token, _ = Token.objects.get_or_create(
        user=user
    )

    return Response(
        {
            "token": token.key,
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
            },
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    username = request.data.get(
        "username"
    )

    password = request.data.get(
        "password"
    )

    if not username or not password:
        return Response(
            {
                "error":
                    "Username and password are required."
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        user = User.objects.get(
            username=username
        )

    except User.DoesNotExist:
        return Response(
            {
                "error":
                    "Invalid credentials."
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not user.check_password(
        password
    ):
        return Response(
            {
                "error":
                    "Invalid credentials."
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    token, _ = Token.objects.get_or_create(
        user=user
    )

    return Response(
        {
            "token": token.key,
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
            },
        }
    )