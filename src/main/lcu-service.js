import { discoverLcuCandidates } from './lcu-discovery.js';
import { LcuClient, readLockfile, readLogConnection } from './lcu-client.js';

function getLocalPlayer(session) {
  const cellId = session?.localPlayerCellId;
  return session?.myTeam?.find((player) => player.cellId === cellId) ?? null;
}

function getChampionId(player) {
  const championId = player?.championId
    ?? player?.selectedChampionId
    ?? player?.championPickIntent
    ?? 0;
  return Number.isInteger(championId) && championId > 0 ? championId : 0;
}

export function createChampSelectSnapshot({ phase, session }) {
  const player = getLocalPlayer(session);
  return {
    status: 'connected',
    phase,
    localPlayerCellId: session?.localPlayerCellId ?? null,
    championId: getChampionId(player),
  };
}

export function resolveGameflowChampion(gameflow, summoner) {
  const data = gameflow?.gameData ?? {};
  const summonerId = /^[1-9]\d*$/.test(String(summoner?.summonerId)) ? String(summoner.summonerId) : null;
  const records = [data.playerChampionSelections, data.teamOne, data.teamTwo]
    .flatMap(value => Array.isArray(value) ? value : []);
  const champions = new Set(records.filter(player => {
    if (summoner?.puuid && player.puuid && player.puuid !== summoner.puuid) return false;
    return (summonerId !== null && String(player.summonerId) === summonerId)
      || (typeof summoner?.puuid === 'string' && summoner.puuid && player.puuid === summoner.puuid);
  })
    .map(player => player.championId).filter(id => Number.isInteger(id) && id > 0));
  return champions.size === 1 ? [...champions][0] : 0;
}

export class LcuService {
  constructor({ findLockfile = discoverLcuCandidates, read = readLockfile, createClient = (connection) => new LcuClient(connection), onConnectionChange = () => {} } = {}) {
    this.findLockfile = findLockfile;
    this.read = read;
    this.createClient = createClient;
    this.onConnectionChange = onConnectionChange;
    this.connectionKey = null;
    this.currentChampionId = 0;
    this.pendingSnapshot = null;
  }

  getSnapshot() {
    this.pendingSnapshot ??= this.readSnapshot().finally(() => { this.pendingSnapshot = null; });
    return this.pendingSnapshot;
  }

  async readSnapshot() {
    try {
      const discovered = await this.findLockfile();
      const paths = Array.isArray(discovered) ? discovered : discovered ? [discovered] : [];
      if (!paths.length) {
        this.currentChampionId = 0;
        this.connectionKey = null;
        return { status: 'disconnected', phase: 'Unavailable', championId: 0 };
      }
      let client, phase, connectionKey, lastError;
      for (const filename of paths) {
        try {
          const connection = typeof filename === 'string' ? await this.read(filename)
            : filename.kind === 'process' ? filename.connection : await readLogConnection(filename.path);
          const candidate = this.createClient(connection);
          phase = await candidate.getGameflowPhase();
          client = candidate;
          // 此身份仅存在主进程内存中，不发送给界面或写入配置。
          connectionKey = JSON.stringify([typeof filename === 'string' ? filename : filename.kind === 'log' ? filename.path : 'process', connection.pid, connection.port, connection.token]);
          break;
        } catch (error) { lastError = error; }
      }
      if (!client) throw lastError;
      if (connectionKey !== this.connectionKey) {
        this.currentChampionId = 0;
        this.connectionKey = connectionKey;
        this.onConnectionChange();
      }
      if (phase === 'InProgress') {
        const [gameflow, summoner] = await Promise.all([client.getGameflowSession(), client.getCurrentSummoner()]);
        if (typeof gameflow?.phase === 'string' && gameflow.phase !== 'InProgress') {
          this.currentChampionId = 0;
          return { status: 'connected', phase: gameflow.phase, championId: 0 };
        }
        this.currentChampionId = resolveGameflowChampion(gameflow, summoner);
        return { status: 'connected', phase, championId: this.currentChampionId };
      }
      if (phase !== 'ChampSelect') {
        if (!['GameStart', 'InProgress', 'Reconnect', 'WaitingForStats', 'PreEndOfGame'].includes(phase)) {
          this.currentChampionId = 0;
        }
        return { status: 'connected', phase, championId: this.currentChampionId };
      }

      const session = await client.getChampSelectSession();
      const snapshot = createChampSelectSnapshot({ phase, session });
      this.currentChampionId = snapshot.championId;
      return snapshot;
    } catch (error) {
      this.currentChampionId = 0;
      this.connectionKey = null;
      const hints = {
        EACCES: '客户端连接文件没有读取权限，请让助手与客户端使用相同的运行权限。',
        EPERM: '客户端连接文件没有读取权限，请让助手与客户端使用相同的运行权限。',
        ENOENT: '客户端连接文件已失效，正在重新检测。请确认客户端已启动并登录。',
        ECONNREFUSED: '已找到客户端连接文件，但本地接口暂未就绪，请等待客户端完成启动。',
      };
      return {
        status: 'error',
        phase: 'Unavailable',
        championId: 0,
        message: hints[error?.code] ?? (error instanceof Error ? error.message : String(error)),
      };
    }
  }
}
