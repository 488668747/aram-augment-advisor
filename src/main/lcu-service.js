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

export class LcuService {
  constructor({ findLockfile = discoverLockfilePath, read = readLockfile, createClient = (connection) => new LcuClient(connection) } = {}) {
    this.findLockfile = findLockfile;
    this.read = read;
    this.createClient = createClient;
  }

  async getSnapshot() {
    const lockfilePath = await this.findLockfile();
    if (!lockfilePath) {
      return { status: 'disconnected', phase: 'Unavailable', championId: 0 };
    }

    try {
      const connection = await this.read(lockfilePath);
      const client = this.createClient(connection);
      const phase = await client.getGameflowPhase();
      if (phase !== 'ChampSelect') {
        return { status: 'connected', phase, championId: 0 };
      }

      const session = await client.getChampSelectSession();
      return createChampSelectSnapshot({ phase, session });
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
