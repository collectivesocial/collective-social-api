import express, { Request, Response } from 'express';
const router = express.Router();
const userModel = require('../models/userModel');

// GET /users/:handle - Get a user by handle
router.get('/:handle', async (req: Request, res: Response) => {
  try {
    const user = await userModel.getUserByHandle(req.params.handle);
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
