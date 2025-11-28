import express, { Request, Response } from 'express';
import { getUserByHandle } from '../models/user';
const router = express.Router();

// GET /users/:handle - Get a user by handle
router.get('/:handle', async (req: Request, res: Response) => {
  try {
    console.log('Fetching user with handle:', req.params.handle);
    const user = await getUserByHandle(req.params.handle);
    console.log(user);
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
