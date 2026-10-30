import { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { increment, decrement, reset } from '../services/counter.service.js';

export async function increment(req: Request<{ value: number }>, res: Response) {
  const { value } = req.body;
  try {
    await increment(value);
    res.status(200).send({ message: 'Counter incremented' });
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : error
    );
    res.status(500).send({ error: 'Internal server error' });
  }
}

export async function decrement(req: Request<{ value: number }>, res: Response) {
  const { value } = req.body;
  try {
    await decrement(value);
    res.status(200).send({ message: 'Counter decremented' });
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : error
    );
    res.status(500).send({ error: 'Internal server error' });
  }
}

export async function reset(req: Request, res: Response) {
  try {
    await reset();
    res.status(200).send({ message: 'Counter reset' });
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : error
    );
    res.status(500).send({ error: 'Internal server error' });
  }
}