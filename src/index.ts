import express from 'express';
import usersRouter from './routes/user';
import { config } from './config';

const app = express();

app.use(express.json());
app.use('/users', usersRouter);

const PORT = config.port;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});