"use client";

export default function LogoutButton() {
  function handleLogout() {
    localStorage.removeItem(
      "token"
    );

    localStorage.removeItem(
      "user"
    );

    window.location.href =
      "/login";
  }

  return (
    <button
      className="btn btn-secondary"
      type="button"
      onClick={handleLogout}
    >
      Logout
    </button>
  );
}