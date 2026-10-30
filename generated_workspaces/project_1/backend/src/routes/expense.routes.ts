import { Router } from "express";

import {
    createExpense,
    deleteExpense,
    getExpenseById,
    getExpenses,
    updateExpense,
} from "../controllers/expense.controller.js";

import {
    AuthMiddleware,
} from "../middleware/auth.middleware.js";


const router = Router();

router.use(
    AuthMiddleware
);

router.post(
    "/",
    createExpense
);

router.get(
    "/",
    getExpenses
);

router.get(
    "/:id",
    getExpenseById
);

router.put(
    "/:id",
    updateExpense
);

router.delete(
    "/:id",
    deleteExpense
);

export default router;