import { discoverLockfilePath } from './lcu-discovery.js';
import { LcuClient, readLockfile } from './lcu-client.js';

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
  constructor({ findLockfile = discoverLockfilePath, read = readLockfile, createClient = (connection) => new LcuClient(connection) } = {}) {
    this.findLockfile = findLockfile;
    this.read = read;
    this.createClient = createClient;
    this.currentChampionId = 0;
    this.pendingSnapshot = null;
  }

  getSnapshot() {
    this.pendingSnapshot ??= this.readSnapshot().finally(() => { this.pendingSnapshot = null; });
    return this.pendingSnapshot;
  }

  async readSnapshot() {
    const lockfilePath = await this.findLockfile();
    if (!lockfilePath) {
      this.currentChampionId = 0;
      return { status: 'disconnected', phase: 'Unavailable', championId: 0 };
    }

    try {
      const connection = await this.read(lockfilePath);
      const client = this.createClient(connection);
      const phase = await client.getGameflowPhase();
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
      return {
        status: 'error',
        phase: 'Unavailable',
        championId: 0,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
