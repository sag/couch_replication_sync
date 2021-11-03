import axios from "axios";

const {
  TARGET_URL,
  TARGET_USER,
  TARGET_PASSWORD,
  SRC_URL,
  SRC_USER,
  SRC_PASSWORD,
} = process.env;

const PAGE_SIZE = parseInt(process.env.PAGE_SIZE, 10) || 100;
//defaults to 1 minute
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL, 10) || 60000;

const TARGET_AUTH = {
  auth: {
    username: TARGET_USER,
    password: TARGET_PASSWORD,
  },
};

const SRC_AUTH = {
  auth: {
    username: SRC_USER,
    password: SRC_PASSWORD,
  },
};

const DEFAULT_IGNORE_LIST = {
  _global_changes: true,
  _users: true,
  _replicator: true,
};

console.log(TARGET_URL);

async function getDbsPage(url, auth, page) {
  let offset = page * PAGE_SIZE;
  let res = await axios.get(
    `${url}/_all_dbs?limit=${PAGE_SIZE}&skip=${offset}`,
    auth
  );
  return res.data;
}

async function getDbs(url, auth) {
  let page = 0;
  let pageResult = null;
  let dbList = [];
  do {
    pageResult = await getDbsPage(url, auth, page);
    page += 1;
    dbList = dbList.concat(pageResult);
  } while (pageResult && pageResult.length >= PAGE_SIZE-1);

  return dbList;
}

function basicAuth(username, password) {
  let digest = Buffer.from(`${username}:${password}`).toString("base64");
  return {
    Authorization: `Basic ${digest}`,
  };
}

const replicationDoc = (db) => {
  return {
    _id: `${db}_rep`,
    source: {
      url: `${SRC_URL}/${db}`,
      headers: basicAuth(SRC_USER, SRC_PASSWORD),
    },
    target: {
      url: `${TARGET_URL}/${db}`,
      headers: basicAuth(TARGET_USER, TARGET_PASSWORD),
    },
    create_target: true,
    continuous: true,
  };
};

async function createReplication(db) {
  return await axios.post(
    `${TARGET_URL}/_replicator`,
    replicationDoc(db),
    TARGET_AUTH
  );
}

const check = async () => {
  try {
    let targetDbs = getDbs(TARGET_URL, TARGET_AUTH);
    let srcDbs = getDbs(SRC_URL, SRC_AUTH);
    let targetIdMap = Object.assign({}, DEFAULT_IGNORE_LIST);
    targetDbs = await targetDbs;
    srcDbs = await srcDbs;

    for (let i = 0; i < (await targetDbs).length; i++) {
      let db = targetDbs[i];
      targetIdMap[db] = true;
    }
    console.log(`target size: ${(await targetDbs).length}`);

    for (let i = 0; i < (await srcDbs).length; i++) {
      let db = srcDbs[i];
      if (!targetIdMap[db]) {
        console.debug(`Found unreplicated db : ${db} -- creating replicator`);
        try {
          let replicationResult = await createReplication(db);
          console.debug(
            `Replication for ${db} completed with status ${replicationResult.status} ${replicationResult.statusText}`
          );
        } catch (e) {
          console.log(`Error creating replication for ${db}`);
          if (e.isAxiosError) {
            console.debug(
              `AXIOS error: ${e.response.status}, ${e.response.statusText}`
            );
          }
        }
      }
    }
  } catch (ex) {
    console.debug(ex);
  }
};

const timerInterval = setInterval(check, CHECK_INTERVAL);

const shutdown = () => {
  console.log("shutting down");
  clearInterval(timerInterval);
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

check();
