import { prisma } from "../config/prisma.js";
function parseId(value) {
    const raw = Array.isArray(value)
        ? value[0]
        : value;
    const id = Number(raw);
    if (!Number.isInteger(id) ||
        id <= 0) {
        return null;
    }
    return id;
}
export async function createCategory(req, res) {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({
                error: "Unauthorized",
            });
            return;
        }
        const { name, type, } = req.body;
        if (typeof name !== "string" ||
            !name.trim() ||
            (type !== "income" &&
                type !== "expense")) {
            res.status(400).json({
                error: "Valid name and type are required",
            });
            return;
        }
        const category = await prisma.category.create({
            data: {
                name: name.trim(),
                type,
                userId,
            },
        });
        res.status(201).json(category);
    }
    catch (error) {
        console.error(error instanceof Error
            ? error.message
            : error);
        res.status(500).json({
            error: "Failed to create category",
        });
    }
}
export async function getCategories(req, res) {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({
                error: "Unauthorized",
            });
            return;
        }
        const categories = await prisma.category.findMany({
            where: {
                userId,
            },
            orderBy: {
                name: "asc",
            },
        });
        res.json(categories);
    }
    catch (error) {
        console.error(error instanceof Error
            ? error.message
            : error);
        res.status(500).json({
            error: "Failed to retrieve categories",
        });
    }
}
export async function getCategory(req, res) {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({
                error: "Unauthorized",
            });
            return;
        }
        const id = parseId(req.params.id);
        if (id === null) {
            res.status(400).json({
                error: "Invalid category ID",
            });
            return;
        }
        const category = await prisma.category.findFirst({
            where: {
                id,
                userId,
            },
        });
        if (!category) {
            res.status(404).json({
                error: "Category not found",
            });
            return;
        }
        res.json(category);
    }
    catch (error) {
        console.error(error instanceof Error
            ? error.message
            : error);
        res.status(500).json({
            error: "Failed to retrieve category",
        });
    }
}
export async function updateCategory(req, res) {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({
                error: "Unauthorized",
            });
            return;
        }
        const id = parseId(req.params.id);
        if (id === null) {
            res.status(400).json({
                error: "Invalid category ID",
            });
            return;
        }
        const existing = await prisma.category.findFirst({
            where: {
                id,
                userId,
            },
        });
        if (!existing) {
            res.status(404).json({
                error: "Category not found",
            });
            return;
        }
        const { name, type, } = req.body;
        const category = await prisma.category.update({
            where: {
                id,
            },
            data: {
                ...(typeof name === "string" && {
                    name: name.trim(),
                }),
                ...(type === "income" ||
                    type === "expense") && {
                    type,
                },
            },
        });
        res.json(category);
    }
    catch (error) {
        console.error(error instanceof Error
            ? error.message
            : error);
        res.status(500).json({
            error: "Failed to update category",
        });
    }
}
export async function deleteCategory(req, res) {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({
                error: "Unauthorized",
            });
            return;
        }
        const id = parseId(req.params.id);
        if (id === null) {
            res.status(400).json({
                error: "Invalid category ID",
            });
            return;
        }
        const existing = await prisma.category.findFirst({
            where: {
                id,
                userId,
            },
        });
        if (!existing) {
            res.status(404).json({
                error: "Category not found",
            });
            return;
        }
        await prisma.category.delete({
            where: {
                id,
            },
        });
        res.status(204).send();
    }
    catch (error) {
        console.error(error instanceof Error
            ? error.message
            : error);
        res.status(500).json({
            error: "Failed to delete category",
        });
    }
}
