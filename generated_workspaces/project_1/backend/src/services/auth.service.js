import "dotenv/config";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma.js";
function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("JWT_SECRET is not configured.");
    }
    return secret;
}
export class AuthService {
    async validateUser(email, password) {
        const user = await prisma.user.findUnique({
            where: {
                email,
            },
        });
        if (!user) {
            return null;
        }
        const passwordValid = await bcrypt.compare(password, user.passwordHash);
        if (!passwordValid) {
            return null;
        }
        return {
            id: user.id,
            email: user.email,
        };
    }
    async registerUser(email, password) {
        const existingUser = await prisma.user.findUnique({
            where: {
                email,
            },
        });
        if (existingUser) {
            throw new Error("Email already exists");
        }
        const passwordHash = await bcrypt.hash(password, 12);
        const user = await prisma.user.create({
            data: {
                email,
                passwordHash,
            },
        });
        return {
            id: user.id,
            email: user.email,
        };
    }
    generateToken(user) {
        const secret = getJwtSecret();
        return jwt.sign({
            userId: user.id,
        }, secret, {
            algorithm: "HS256",
            expiresIn: "1h",
        });
    }
}
