import jwt from "jsonwebtoken";
export function AuthMiddleware(req, res, next) {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
        res.status(401).json({
            error: "Authentication token required",
        });
        return;
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        res.status(500).json({
            error: "Authentication is not configured",
        });
        return;
    }
    const token = authorization.slice(7);
    try {
        const payload = jwt.verify(token, secret, {
            algorithms: ["HS256"],
        });
        if (typeof payload === "string" ||
            !Number.isSafeInteger(payload.userId) ||
            payload.userId <= 0) {
            res.status(401).json({
                error: "Invalid authentication token",
            });
            return;
        }
        req.userId = payload.userId;
        next();
    }
    catch {
        res.status(401).json({
            error: "Invalid or expired token",
        });
    }
}
