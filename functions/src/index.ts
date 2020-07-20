import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as _ from 'lodash';
const { CloudTasksClient } = require('@google-cloud/tasks');
admin.initializeApp();
// const db = admin.firestore();
// const auth = admin.auth();

// Get the project ID from the FIREBASE_CONFIG env var

const location = 'europe-west2';
const project = JSON.parse(process.env.FIREBASE_CONFIG!).projectId;
const serviceAccountEmail = 'cloudtask@randottery-dev.iam.gserviceaccount.com';

export const addToTaskQueue = functions
  .region(location)
  .firestore.document('/lotteries/{documentId}')
  .onCreate((snap, context) => {
    functions.logger.log('Changing status to ready', context.params.documentId);
    const endDate = snap.data().endDate;
    // const project = 'randottery';
    const queue = 'firestore-ttl';
    const tasksClient = new CloudTasksClient();
    const queuePath: string = tasksClient.queuePath(project, location, queue);
    const url = `https://${location}-${project}.cloudfunctions.net/initLotterySolver?id=${context.params.documentId}`;
    const task = {
      httpRequest: {
        httpMethod: 'POST',
        url,
        oidcToken: {
          serviceAccountEmail,
        },
      },
      scheduleTime: {
        seconds: endDate.seconds,
      },
    };

    // You must return a Promise when performing asynchronous tasks inside a Functions such as
    // writing to Cloud Firestore.
    // Setting an 'uppercase' field in Cloud Firestore document returns a Promise.
    // return snap.ref
    //   .set({ taskId: '32434534456' }, { merge: true })
    //   .then((res) => {
    //     return tasksClient.createTask({
    //       parent: queuePath,
    //       task,
    //     });
    //   });

    return tasksClient.createTask({
      parent: queuePath,
      task,
    });
  });

export const initLotterySolver = functions
  .region(location)
  .https.onRequest(async (req, res) => {
    const lotteryId: any = req.query.id;
    if (!lotteryId) {
      functions.logger.error('Lottery ID missing');
      res.status(400).json({ message: `Lottery ID missing` });
      return;
    }
    // Push the new message into Cloud Firestore using the Firebase Admin SDK.
    const lotteryRef = admin.firestore().collection('lotteries').doc(lotteryId);
    const doc = await lotteryRef.get();

    if (!doc.exists) {
      functions.logger.error('Lottery does not exist');
      res.status(400).json({ message: `Lottery does not exist` });
      return;
    }

    const { participants, numberOfWinners, winners, status }: any = doc.data();
    if (winners || status !== 'active') {
      functions.logger.error('Lottery already closed');
      res.status(400).json({ message: `Lottery already closed` });
      return;
    }
    const winnersResult = _.chain(participants)
      .shuffle()
      .slice(0, numberOfWinners)
      .value();

    try {
      await lotteryRef.set(
        {
          winners: winnersResult,
          taskId: admin.firestore.FieldValue.delete(),
          status: 'ended',
        },
        { merge: true }
      );
      res.status(200).json({ message: `ok`, winners: winnersResult });
      return;
    } catch (err) {
      functions.logger.error('Something is wrong', err);
      res.status(400).json({ message: `Something is wrong`, err });
      return;
    }
  });
