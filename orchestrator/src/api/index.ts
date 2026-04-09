import { Router } from 'express';
import agentsRouter from './agents';
import tasksRouter from './tasks';
import messagesRouter from './messages';
import prdsRouter from './prds';
import kbRouter from './kb';
import evoRouter from './evo';
import eventsRouter from './events';

const apiRouter = Router();

apiRouter.use('/agents', agentsRouter);
apiRouter.use('/tasks', tasksRouter);
apiRouter.use('/messages', messagesRouter);
apiRouter.use('/prds', prdsRouter);
apiRouter.use('/kb', kbRouter);
apiRouter.use('/evo', evoRouter);
apiRouter.use('/events', eventsRouter);

export default apiRouter;
