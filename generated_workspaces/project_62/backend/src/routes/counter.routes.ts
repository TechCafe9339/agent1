import { Router } from 'express';
import { increment, decrement, reset } from '../controllers/counter.controller.js';

export default function counterRoutes(): Router {
  const router = Router();

  router.post('/increment', increment);
  router.post('/decrement', decrement);
  router.post('/reset', reset);

  return router;
}