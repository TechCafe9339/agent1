import { AuthService } from "../services/auth.service.js";
export class AuthController {
    authService;
    constructor() {
        this.authService = new AuthService();
    }
    login = async (req, res) => {
        try {
            const { email, password } = req.body;
            if (typeof email !== "string" ||
                typeof password !== "string" ||
                !email.trim() ||
                !password) {
                res.status(400).json({
                    error: "Email and password are required",
                });
                return;
            }
            const user = await this.authService.validateUser(email.trim().toLowerCase(), password);
            if (!user) {
                res.status(401).json({
                    error: "Invalid email or password",
                });
                return;
            }
            const token = this.authService.generateToken(user);
            res.status(200).json({
                message: "Login successful",
                token,
                user,
            });
        }
        catch (error) {
            console.error("Login failed:", error);
            res.status(500).json({
                error: "Unable to process login",
            });
        }
    };
    register = async (req, res) => {
        try {
            const { email, password } = req.body;
            if (typeof email !== "string" ||
                typeof password !== "string" ||
                !email.trim() ||
                password.length < 8) {
                res.status(400).json({
                    error: "Valid email and password of at least 8 characters required",
                });
                return;
            }
            const user = await this.authService.registerUser(email.trim().toLowerCase(), password);
            const token = this.authService.generateToken(user);
            res.status(201).json({
                message: "Registration successful",
                token,
                user,
            });
        }
        catch (error) {
            if (error instanceof Error &&
                error.message ===
                    "Email already exists") {
                res.status(409).json({
                    error: "Email already exists",
                });
                return;
            }
            console.error("Registration failed:", error);
            res.status(500).json({
                error: "Unable to register user",
            });
        }
    };
}
