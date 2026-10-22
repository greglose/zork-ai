// Hand-written picture prompts for Zork I, kept as data (rooms.json, moments.json) and read through these helpers.
// A room id is the lowercased, trimmed name the status line shows, which is the DESC string in the game source;
// rooms that share a name (the 15 maze rooms, the 4 forests...) share one prompt. See the README for the format.
import momentsJson from './moments.json';
import roomsJson from './rooms.json';

export type RoomScene = {
  /** Purely visual description of the place as it looks when lit. No art style: the player's picker supplies that. */
  prompt: string;
  /** True when no lamp-free light reaches the room (no ONBIT flag in the game source). */
  dark?: boolean;
};

export type Moment = {
  id: string;
  roomId: string;
  /** Case-insensitive regex source, tested against one turn's new game text. */
  when: string;
  /** The same view as the room prompt, with the change. */
  prompt: string;
};

export const ROOM_SCENES: Readonly<Record<string, RoomScene>> = roomsJson;
export const MOMENTS: readonly Moment[] = momentsJson;

export interface SceneData {
  room(roomId: string): RoomScene | null;
  moment(id: string): Moment | null;
  /** The moments of this room whose trigger matches the turn text and that are not in `fired`, in file order. */
  matching(roomId: string, turnText: string, fired: ReadonlySet<string>): Moment[];
}

export function createSceneData(rooms: Readonly<Record<string, RoomScene>>, moments: readonly Moment[]): SceneData {
  const compiled = moments.flatMap((m) => {
    try {
      return [{ m, re: new RegExp(m.when, 'i') }];
    } catch {
      return []; // A bad pattern never fires; tests/scenes.test.ts keeps the shipped data valid.
    }
  });
  const byId = new Map(moments.map((m) => [m.id, m]));
  return {
    room: (roomId) => (Object.hasOwn(rooms, roomId) ? rooms[roomId] : null),
    moment: (id) => byId.get(id) ?? null,
    matching: (roomId, text, fired) => compiled.filter((c) => c.m.roomId === roomId && !fired.has(c.m.id) && c.re.test(text)).map((c) => c.m),
  };
}

export const ZORK_SCENES: SceneData = createSceneData(ROOM_SCENES, MOMENTS);
export const NO_SCENES: SceneData = createSceneData({}, []);

export const roomScene = (roomId: string): RoomScene | null => ZORK_SCENES.room(roomId);
export const matchingMoments = (roomId: string, text: string, fired: ReadonlySet<string>): Moment[] =>
  ZORK_SCENES.matching(roomId, text, fired);
export const momentsIn = (roomId: string): Moment[] => MOMENTS.filter((m) => m.roomId === roomId);
