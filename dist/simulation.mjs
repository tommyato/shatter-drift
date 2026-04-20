var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/constants.ts
var PLAYABLE_HALF_WIDTH = 10;
var LANE_WIDTH = 9;
var WALL_DISTANCE = LANE_WIDTH / 2 + 1.5;
var MAX_SPEED = 45;
var PLAYER_MOVE_SPEED = 8;
var PLAYER_COLLISION_RADIUS = 0.25;
var PHASE_DRAIN_RATE = 0.25;
var PHASE_RECHARGE_RATE = 0.15;
var PHASE_MIN_THRESHOLD = 0.2;
var ORB_SCORE = 100;
var CLOSE_CALL_SCORE = 50;
var SPAWN_DISTANCE = 80;
var DESPAWN_DISTANCE = -10;
var ORB_SPACING = 3;
var INITIAL_OBSTACLE_Z = 30;
var INITIAL_ORB_Z = 15;
var LOOKAHEAD_OBSTACLES = 5;
var LOOKAHEAD_DISTANCE = 80;
var DEFAULT_FIXED_DT = 1 / 60;
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 1831565813;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function getSystemRandom() {
  return () => Math.random();
}
function computeSpeed(distance, skillFactor = 1) {
  if (distance < 300) {
    return (12 + distance / 300 * 8) * skillFactor;
  }
  if (distance < 700) {
    return (20 + (distance - 300) / 400 * 10) * skillFactor;
  }
  if (distance < 1200) {
    return (30 + (distance - 700) / 500 * 8) * skillFactor;
  }
  if (distance < 1800) {
    return (38 + (distance - 1200) / 600 * 5) * skillFactor;
  }
  return Math.min(MAX_SPEED, 43 + (distance - 1800) / 500 * 2) * skillFactor;
}

// src/lib/di/injected.ts
var registry = /* @__PURE__ */ new WeakMap();
function injected(injectable, ...tokens) {
  registry.set(injectable, tokens);
}
function getInjectedTokens(factory) {
  return registry.get(factory);
}

// src/lib/di/container.ts
var MissingBindingError = class extends Error {
  constructor(description) {
    super(`No binding found for token: "${description}"`);
    this.name = "MissingBindingError";
  }
};
var DuplicateBindingError = class extends Error {
  constructor(description) {
    super(`Token "${description}" is already bound. Use a separate token or create a child container.`);
    this.name = "DuplicateBindingError";
  }
};
var CircularDependencyError = class extends Error {
  constructor(chain) {
    super(`Circular dependency detected: ${chain.join(" -> ")}`);
    this.name = "CircularDependencyError";
  }
};
var containerScopeCache = /* @__PURE__ */ new WeakMap();
function getContainerCache(container) {
  let cache = containerScopeCache.get(container);
  if (cache === void 0) {
    cache = /* @__PURE__ */ new Map();
    containerScopeCache.set(container, cache);
  }
  return cache;
}
var ContainerImpl = class _ContainerImpl {
  constructor(parent, rootResolvingSet, resolvingChain) {
    __publicField(this, "bindings", /* @__PURE__ */ new Map());
    __publicField(this, "parent");
    __publicField(this, "rootResolvingSet");
    __publicField(this, "resolvingChain");
    __publicField(this, "destroyed", false);
    this.parent = parent;
    this.rootResolvingSet = rootResolvingSet;
    this.resolvingChain = resolvingChain;
  }
  bind(token) {
    if (this.destroyed) {
      throw new Error("Container has been destroyed");
    }
    const sym = token.__s;
    if (this.bindings.has(sym)) {
      throw new DuplicateBindingError(token.__d);
    }
    const binding = {
      token,
      type: "factory",
      scope: "transient",
      hasCachedInstance: false
    };
    const makeScopeBuilder = () => ({
      asSingleton: () => {
        binding.scope = "singleton";
      },
      asTransient: () => {
        binding.scope = "transient";
      },
      asContainerScoped: () => {
        binding.scope = "container";
      },
      inSingletonScope: () => {
        binding.scope = "singleton";
      },
      inTransientScope: () => {
        binding.scope = "transient";
      },
      inContainerScope: () => {
        binding.scope = "container";
      }
    });
    const makeDepsBuilder = (injectable) => {
      const scopeBuilder = makeScopeBuilder();
      const depsBuilder = {
        withDeps: (...tokens) => {
          ;
          injected(
            injectable,
            ...tokens
          );
          return scopeBuilder;
        },
        ...scopeBuilder
      };
      return depsBuilder;
    };
    return {
      toValue: (value) => {
        ;
        binding.scope = "singleton";
        binding.type = "value";
        binding.cachedInstance = value;
        binding.hasCachedInstance = true;
        this.bindings.set(sym, binding);
      },
      toFactory: (factory) => {
        ;
        binding.type = "factory";
        binding.factory = factory;
        this.bindings.set(sym, binding);
        return makeDepsBuilder(factory);
      },
      toClass: (ctor) => {
        ;
        binding.type = "class";
        binding.ctor = ctor;
        this.bindings.set(sym, binding);
        return makeDepsBuilder(ctor);
      }
    };
  }
  get(token) {
    if (this.destroyed) {
      throw new Error("Container has been destroyed");
    }
    if (token.__o) {
      try {
        return this.resolve(token.__s, token.__d);
      } catch (error) {
        if (error instanceof MissingBindingError) {
          return void 0;
        }
        throw error;
      }
    }
    return this.resolve(token.__s, token.__d);
  }
  createChild() {
    if (this.destroyed) {
      throw new Error("Container has been destroyed");
    }
    return new _ContainerImpl(this, this.rootResolvingSet, this.resolvingChain);
  }
  destroy() {
    this.destroyed = true;
    this.bindings.clear();
    const cache = containerScopeCache.get(this);
    cache?.clear();
  }
  resolve(sym, description) {
    if (this.rootResolvingSet.has(sym)) {
      throw new CircularDependencyError([...this.resolvingChain, description]);
    }
    const owner = this.findOwner(sym);
    if (owner === null) {
      throw new MissingBindingError(description);
    }
    const binding = owner.bindings.get(sym);
    if (binding.type === "value") {
      return binding.cachedInstance;
    }
    if (binding.scope === "singleton") {
      if (binding.hasCachedInstance) {
        return binding.cachedInstance;
      }
      return this.instantiateCached(binding, owner, sym, description, owner);
    }
    if (binding.scope === "container") {
      const cache = getContainerCache(this);
      if (cache.has(sym)) {
        return cache.get(sym);
      }
      return this.instantiateCached(binding, this, sym, description, this);
    }
    this.rootResolvingSet.add(sym);
    this.resolvingChain.push(description);
    try {
      return binding.type === "class" ? this.callClass(binding.ctor) : this.callFactory(binding.factory);
    } finally {
      this.rootResolvingSet.delete(sym);
      this.resolvingChain.pop();
    }
  }
  instantiateCached(binding, cacheOwner, sym, description, containerForContainerScope) {
    this.rootResolvingSet.add(sym);
    this.resolvingChain.push(description);
    try {
      const instance = binding.type === "class" ? this.callClass(binding.ctor) : this.callFactory(binding.factory);
      if (binding.scope === "singleton") {
        ;
        binding.cachedInstance = instance;
        binding.hasCachedInstance = true;
      } else {
        getContainerCache(containerForContainerScope).set(sym, instance);
      }
      return instance;
    } finally {
      this.rootResolvingSet.delete(sym);
      this.resolvingChain.pop();
      void cacheOwner;
    }
  }
  callFactory(factory) {
    const depTokens = getInjectedTokens(factory);
    if (depTokens === void 0) {
      if (factory.length > 0) {
        throw new Error(
          `Factory "${factory.name || "(anonymous)"}" has ${factory.length} parameter(s) but no deps were registered. Use .withDeps(TokenA, ...) when binding.`
        );
      }
      return factory();
    }
    const args = depTokens.map((depToken) => this.get(depToken));
    return factory(...args);
  }
  callClass(ctor) {
    const depTokens = getInjectedTokens(ctor);
    if (depTokens === void 0) {
      if (ctor.length > 0) {
        throw new Error(
          `Class "${ctor.name}" has ${ctor.length} constructor parameter(s) but no deps were registered. Use .withDeps(TokenA, ...) when binding.`
        );
      }
      return new ctor();
    }
    const args = depTokens.map((depToken) => this.get(depToken));
    return new ctor(...args);
  }
  findOwner(sym) {
    if (this.bindings.has(sym)) {
      return this;
    }
    return this.parent?.findOwner(sym) ?? null;
  }
};
function createContainer() {
  return new ContainerImpl(null, /* @__PURE__ */ new Set(), []);
}

// src/input/agent-input.ts
var ACTION_TO_STATE = {
  0: { horizontal: 0, shatter: false },
  1: { horizontal: -1, shatter: false },
  2: { horizontal: 1, shatter: false },
  3: { horizontal: 0, shatter: true },
  4: { horizontal: -1, shatter: true },
  5: { horizontal: 1, shatter: true }
};
function createAgentInput() {
  let currentAction = 0;
  return {
    getState() {
      return ACTION_TO_STATE[currentAction] ?? ACTION_TO_STATE[0];
    },
    setAction(action) {
      currentAction = Number.isFinite(action) ? Math.trunc(action) : 0;
    },
    reset() {
      currentAction = 0;
    }
  };
}

// src/sim-world.ts
function createInitialState() {
  return {
    playerX: 0,
    playerZ: 0,
    shattered: false,
    phaseEnergy: 1,
    phaseLocked: false,
    speed: 0,
    score: 0,
    alive: true,
    obstacles: [],
    orbs: [],
    nextObstacleZ: 30,
    nextOrbZ: 15,
    lastCloseCallZ: -10,
    nextBossZ: 500,
    // matches BOSS_INTERVAL in bosswaves.ts
    bossCount: 0
  };
}
function createSimulationWorld(input, random) {
  let state = createInitialState();
  const events = [];
  return {
    input,
    random,
    get state() {
      return state;
    },
    reset() {
      state = createInitialState();
      input.reset();
      events.length = 0;
    },
    pushEvent(event) {
      events.push(event);
    },
    drainEvents() {
      const drained = events.slice();
      events.length = 0;
      return drained;
    },
    addScore(points) {
      state.score += points;
    },
    getState() {
      const cooldown = state.phaseLocked && state.phaseEnergy < PHASE_MIN_THRESHOLD ? (PHASE_MIN_THRESHOLD - state.phaseEnergy) / PHASE_RECHARGE_RATE : 0;
      return {
        playerX: state.playerX,
        shattered: state.shattered,
        shatterCooldown: cooldown,
        speed: state.speed,
        distance: state.playerZ,
        score: Math.round(state.score),
        alive: state.alive,
        obstacles: state.obstacles.filter((obstacle) => obstacle.active).map((obstacle) => ({
          z: obstacle.z,
          x: obstacle.x,
          halfWidth: obstacle.halfWidth,
          halfHeight: obstacle.halfHeight,
          isGate: obstacle.isGate,
          gapX: obstacle.gapX,
          gapHalfWidth: obstacle.gapHalfWidth,
          active: obstacle.active,
          wallSegments: obstacle.wallSegments?.map((segment) => ({
            x: segment.x,
            halfWidth: segment.halfWidth
          }))
        })),
        orbs: state.orbs.filter((orb) => orb.active).map((orb) => ({
          x: orb.x,
          z: orb.z
        }))
      };
    },
    getObservation() {
      const observation = new Float64Array(4 + LOOKAHEAD_OBSTACLES * 4);
      observation[0] = clamp(state.playerX / PLAYABLE_HALF_WIDTH, -1, 1);
      observation[1] = state.shattered ? 1 : 0;
      observation[2] = clamp(state.speed / MAX_SPEED, 0, 1);
      observation[3] = clamp(
        state.phaseLocked && state.phaseEnergy < PHASE_MIN_THRESHOLD ? (PHASE_MIN_THRESHOLD - state.phaseEnergy) / PHASE_MIN_THRESHOLD : 0,
        0,
        1
      );
      const upcoming = state.obstacles.filter((obstacle) => obstacle.active && obstacle.z >= state.playerZ).sort((a, b) => a.z - b.z).slice(0, LOOKAHEAD_OBSTACLES);
      upcoming.forEach((obstacle, index) => {
        const offset = 4 + index * 4;
        observation[offset] = clamp((obstacle.z - state.playerZ) / LOOKAHEAD_DISTANCE, 0, 1);
        observation[offset + 1] = clamp(
          (obstacle.isGate ? obstacle.gapX : obstacle.x) / PLAYABLE_HALF_WIDTH,
          -1,
          1
        );
        observation[offset + 2] = clamp(
          (obstacle.isGate ? obstacle.gapHalfWidth * 2 : obstacle.halfWidth * 2) / (PLAYABLE_HALF_WIDTH * 2),
          0,
          1
        );
        observation[offset + 3] = obstacle.isGate ? 1 : 0;
      });
      return observation;
    }
  };
}
function markOrbCollected(world) {
  world.addScore(ORB_SCORE);
  world.pushEvent({ type: "orb_collected" });
}
function markCloseCall(world) {
  world.addScore(CLOSE_CALL_SCORE);
  world.pushEvent({ type: "close_call" });
}

// src/lib/token/token.ts
function createToken(description) {
  const sym = Symbol(description);
  const optional = {
    __t: null,
    __s: sym,
    __d: description,
    __o: true
  };
  return {
    __t: null,
    __s: sym,
    __d: description,
    __o: false,
    optional
  };
}

// src/tokens.ts
var RandomToken = createToken("Random");
var SimulationInputToken = createToken("SimulationInput");
var SimulationWorldToken = createToken("SimulationWorld");
var PlayerMovementSystemToken = createToken("PlayerMovementSystem");
var WorldScrollSystemToken = createToken("WorldScrollSystem");
var ObstacleSpawnSystemToken = createToken("ObstacleSpawnSystem");
var ObstacleDespawnSystemToken = createToken("ObstacleDespawnSystem");
var CollisionSystemToken = createToken("CollisionSystem");
var ShatterSystemToken = createToken("ShatterSystem");
var OrbSystemToken = createToken("OrbSystem");

// src/systems/collision-system.ts
function findCollision(world) {
  for (const obstacle of world.state.obstacles) {
    if (!obstacle.active) {
      continue;
    }
    const dz = Math.abs(world.state.playerZ - obstacle.z);
    if (dz > 2) {
      continue;
    }
    if (obstacle.isGate && obstacle.wallSegments) {
      for (const segment of obstacle.wallSegments) {
        const dx2 = Math.abs(world.state.playerX - segment.x);
        if (dx2 < segment.halfWidth + PLAYER_COLLISION_RADIUS - 0.15) {
          return obstacle;
        }
      }
      continue;
    }
    const dx = Math.abs(world.state.playerX - obstacle.x);
    if (dx < obstacle.halfWidth + PLAYER_COLLISION_RADIUS) {
      return obstacle;
    }
  }
  return null;
}
function createCollisionSystem(world) {
  return (_dt) => {
    if (!world.state.alive || world.state.shattered) {
      return;
    }
    const hit = findCollision(world);
    if (!hit) {
      return;
    }
    world.state.alive = false;
    world.pushEvent({ type: "death" });
  };
}

// src/systems/obstacle-despawn-system.ts
function createObstacleDespawnSystem(world) {
  return (_dt) => {
    for (const obstacle of world.state.obstacles) {
      if (!obstacle.active) {
        continue;
      }
      if (obstacle.z < world.state.playerZ + DESPAWN_DISTANCE) {
        obstacle.active = false;
        if (!obstacle.passed) {
          obstacle.passed = true;
          world.pushEvent({ type: "obstacle_passed" });
        }
      }
    }
    for (const orb of world.state.orbs) {
      if (orb.active && orb.z < world.state.playerZ + DESPAWN_DISTANCE) {
        orb.active = false;
      }
    }
    world.state.obstacles = world.state.obstacles.filter((obstacle) => obstacle.active);
    world.state.orbs = world.state.orbs.filter((orb) => orb.active);
  };
}

// src/systems/obstacle-spawn-system.ts
var BOSS_WAVE_INTERVAL = 500;
function createGate(world, z, gapHalfWidth) {
  const gapX = (world.random() - 0.5) * 5;
  const leftWidth = gapX - gapHalfWidth + PLAYABLE_HALF_WIDTH;
  const rightStart = gapX + gapHalfWidth;
  const rightWidth = PLAYABLE_HALF_WIDTH - rightStart;
  const wallSegments = [];
  if (leftWidth > 0.5) {
    wallSegments.push({
      x: -PLAYABLE_HALF_WIDTH + leftWidth / 2,
      halfWidth: leftWidth / 2
    });
  }
  if (rightWidth > 0.5) {
    wallSegments.push({
      x: rightStart + rightWidth / 2,
      halfWidth: rightWidth / 2
    });
  }
  world.state.obstacles.push({
    z,
    x: 0,
    halfWidth: PLAYABLE_HALF_WIDTH,
    halfHeight: 1.5,
    isGate: true,
    gapX,
    gapHalfWidth,
    active: true,
    partiallyShattered: false,
    passed: false,
    wallSegments
  });
}
function createPillar(world, z, x, width) {
  const centerX = x ?? (world.random() - 0.5) * 6;
  const actualWidth = width ?? 1 + world.random() * 1.5;
  const height = 2 + world.random() * 2;
  world.state.obstacles.push({
    z,
    x: centerX,
    halfWidth: actualWidth / 2,
    halfHeight: height / 2,
    isGate: false,
    gapX: 0,
    gapHalfWidth: 0,
    active: true,
    partiallyShattered: false,
    passed: false
  });
}
function createWideBar(world, z) {
  const gapSide = world.random() < 0.5 ? -1 : 1;
  const gapX = gapSide * (2 + world.random() * 2);
  const gapHalfWidth = 2;
  const gapLeft = gapX - gapHalfWidth;
  const gapRight = gapX + gapHalfWidth;
  const leftWidth = gapLeft + PLAYABLE_HALF_WIDTH;
  const rightWidth = PLAYABLE_HALF_WIDTH - gapRight;
  const wallSegments = [];
  if (leftWidth > 0.5) {
    wallSegments.push({
      x: -PLAYABLE_HALF_WIDTH + leftWidth / 2,
      halfWidth: leftWidth / 2
    });
  }
  if (rightWidth > 0.5) {
    wallSegments.push({
      x: gapRight + rightWidth / 2,
      halfWidth: rightWidth / 2
    });
  }
  world.state.obstacles.push({
    z,
    x: 0,
    halfWidth: PLAYABLE_HALF_WIDTH,
    halfHeight: 0.75,
    isGate: true,
    gapX,
    gapHalfWidth,
    active: true,
    partiallyShattered: false,
    passed: false,
    wallSegments
  });
}
function spawnObstacle(world, z) {
  const type = world.random();
  if (type < 0.4) {
    createGate(world, z, 2.25);
    return;
  }
  if (type < 0.7) {
    createPillar(world, z);
    return;
  }
  if (type < 0.85) {
    const spread = 2 + world.random() * 2;
    const offset = (world.random() - 0.5) * 2;
    createPillar(world, z, offset - spread, 1 + world.random());
    createPillar(world, z, offset + spread, 1 + world.random());
    return;
  }
  createWideBar(world, z);
}
function spawnOrbCluster(world, z) {
  const count = 1 + Math.floor(world.random() * 3);
  const baseX = (world.random() - 0.5) * 6;
  for (let index = 0; index < count; index += 1) {
    world.state.orbs.push({
      x: baseX + (index - (count - 1) / 2) * 1.5,
      z: z + index * 1.5,
      active: true
    });
  }
}
function getObstacleSpacing(world) {
  const distance = world.state.playerZ;
  if (distance < 300) {
    return 18 + world.random() * 6;
  }
  if (distance < 700) {
    return 13 + world.random() * 5;
  }
  if (distance < 1200) {
    return 9 + world.random() * 4;
  }
  if (distance < 1800) {
    return 7 + world.random() * 4;
  }
  return 5 + world.random() * 4;
}
function spawnBossSpinningGate(world, bossZ) {
  for (const zOff of [-6, -2, 2, 6]) {
    world.state.obstacles.push({
      z: bossZ + zOff,
      x: 0,
      halfWidth: 3,
      halfHeight: 1.5,
      isGate: false,
      gapX: 0,
      gapHalfWidth: 0,
      active: true,
      partiallyShattered: false,
      passed: false
    });
  }
}
function spawnBossConvergingWalls(world, bossZ) {
  for (const zOff of [-5, 0, 5]) {
    createGate(world, bossZ + zOff, 1.5);
  }
}
function spawnBossOrbitalRings(world, bossZ) {
  const zOffsets = [-6, -3, 0, 3, 6];
  zOffsets.forEach((zOff, i) => {
    world.state.obstacles.push({
      z: bossZ + zOff,
      x: i % 2 === 0 ? -2 : 2,
      halfWidth: 0.75,
      halfHeight: 1.5,
      isGate: false,
      gapX: 0,
      gapHalfWidth: 0,
      active: true,
      partiallyShattered: false,
      passed: false
    });
  });
}
function spawnBossLaserGrid(world, bossZ) {
  for (const zOff of [-6, -2, 2, 6]) {
    world.state.obstacles.push({
      z: bossZ + zOff,
      x: 0,
      halfWidth: PLAYABLE_HALF_WIDTH,
      halfHeight: 0.4,
      isGate: false,
      gapX: 0,
      gapHalfWidth: 0,
      active: true,
      partiallyShattered: false,
      passed: false
    });
  }
}
function spawnBossWave(world, bossZ) {
  switch (world.state.bossCount % 4) {
    case 0:
      spawnBossSpinningGate(world, bossZ);
      break;
    case 1:
      spawnBossConvergingWalls(world, bossZ);
      break;
    case 2:
      spawnBossOrbitalRings(world, bossZ);
      break;
    case 3:
      spawnBossLaserGrid(world, bossZ);
      break;
  }
}
function createObstacleSpawnSystem(world) {
  return (_dt) => {
    if (world.state.nextObstacleZ === 0) {
      world.state.nextObstacleZ = INITIAL_OBSTACLE_Z;
    }
    if (world.state.nextOrbZ === 0) {
      world.state.nextOrbZ = INITIAL_ORB_Z;
    }
    while (world.state.nextObstacleZ < world.state.playerZ + SPAWN_DISTANCE) {
      spawnObstacle(world, world.state.nextObstacleZ);
      world.state.nextObstacleZ += getObstacleSpacing(world);
    }
    while (world.state.nextOrbZ < world.state.playerZ + SPAWN_DISTANCE) {
      spawnOrbCluster(world, world.state.nextOrbZ);
      world.state.nextOrbZ += ORB_SPACING + world.random() * 5;
    }
    while (world.state.nextBossZ < world.state.playerZ + SPAWN_DISTANCE) {
      spawnBossWave(world, world.state.nextBossZ);
      world.state.nextBossZ += BOSS_WAVE_INTERVAL;
      world.state.bossCount += 1;
    }
  };
}
function destroyObstacle(world, obstacle, impactX) {
  if (!obstacle.active) {
    return false;
  }
  if (!obstacle.isGate) {
    obstacle.active = false;
    world.pushEvent({ type: "wall_destroyed" });
    return true;
  }
  if (!obstacle.wallSegments || obstacle.wallSegments.length === 0) {
    obstacle.active = false;
    return false;
  }
  let nearestIndex = 0;
  let nearestDistance = Infinity;
  for (let index = 0; index < obstacle.wallSegments.length; index += 1) {
    const distance = Math.abs(impactX - obstacle.wallSegments[index].x);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  obstacle.wallSegments.splice(nearestIndex, 1);
  obstacle.partiallyShattered = true;
  world.pushEvent({ type: "wall_destroyed" });
  if (obstacle.wallSegments.length === 0) {
    obstacle.active = false;
    return true;
  }
  if (obstacle.wallSegments.length === 1) {
    const segment = obstacle.wallSegments[0];
    if (segment.x < 0) {
      const rightEdge = obstacle.gapX + obstacle.gapHalfWidth;
      obstacle.gapX = (-PLAYABLE_HALF_WIDTH + rightEdge) / 2;
      obstacle.gapHalfWidth = (rightEdge + PLAYABLE_HALF_WIDTH) / 2;
    } else {
      const leftEdge = obstacle.gapX - obstacle.gapHalfWidth;
      obstacle.gapX = (leftEdge + PLAYABLE_HALF_WIDTH) / 2;
      obstacle.gapHalfWidth = (PLAYABLE_HALF_WIDTH - leftEdge) / 2;
    }
  }
  return true;
}

// src/systems/orb-system.ts
function createOrbSystem(world) {
  return (_dt) => {
    if (!world.state.alive || world.state.shattered) {
      return;
    }
    for (const orb of world.state.orbs) {
      if (!orb.active) {
        continue;
      }
      const dx = world.state.playerX - orb.x;
      const dz = world.state.playerZ - orb.z;
      if (Math.sqrt(dx * dx + dz * dz) < 1.1) {
        orb.active = false;
        markOrbCollected(world);
      }
    }
  };
}

// src/systems/player-movement-system.ts
function createPlayerMovementSystem(world) {
  return (dt) => {
    const input = world.input.getState();
    world.state.playerX = clamp(
      world.state.playerX + input.horizontal * PLAYER_MOVE_SPEED * dt,
      -PLAYABLE_HALF_WIDTH,
      PLAYABLE_HALF_WIDTH
    );
  };
}

// src/systems/shatter-system.ts
function createShatterSystem(world) {
  return (dt) => {
    if (!world.state.alive) {
      world.state.shattered = false;
      return;
    }
    const input = world.input.getState();
    const wasShattered = world.state.shattered;
    const wantsToShatter = input.shatter && !world.state.phaseLocked;
    if (wantsToShatter) {
      world.state.phaseEnergy = Math.max(0, world.state.phaseEnergy - PHASE_DRAIN_RATE * dt);
    } else {
      world.state.phaseEnergy = Math.min(1, world.state.phaseEnergy + PHASE_RECHARGE_RATE * dt);
    }
    if (world.state.phaseEnergy <= 0) {
      world.state.phaseEnergy = 0;
      world.state.phaseLocked = true;
      world.state.shattered = false;
    } else if (world.state.phaseLocked && world.state.phaseEnergy >= PHASE_MIN_THRESHOLD) {
      world.state.phaseLocked = false;
    }
    world.state.shattered = wantsToShatter && !world.state.phaseLocked && world.state.phaseEnergy > 0;
    if (world.state.shattered && !wasShattered) {
      world.pushEvent({ type: "shatter_activated" });
    }
    if (!world.state.shattered) {
      return;
    }
    for (const obstacle of world.state.obstacles) {
      if (!obstacle.active) {
        continue;
      }
      const dz = Math.abs(world.state.playerZ - obstacle.z);
      if (dz > 1.5) {
        continue;
      }
      let withinCloseCall = false;
      if (obstacle.isGate && obstacle.wallSegments) {
        if (obstacle.partiallyShattered) {
          continue;
        }
        for (const segment of obstacle.wallSegments) {
          if (Math.abs(world.state.playerX - segment.x) < segment.halfWidth + 0.8) {
            withinCloseCall = true;
            break;
          }
        }
      } else {
        withinCloseCall = Math.abs(world.state.playerX - obstacle.x) < obstacle.halfWidth + 0.8;
      }
      if (!withinCloseCall) {
        continue;
      }
      destroyObstacle(world, obstacle, world.state.playerX);
      if (world.state.playerZ - world.state.lastCloseCallZ > 3) {
        world.state.lastCloseCallZ = world.state.playerZ;
        markCloseCall(world);
      }
    }
  };
}

// src/systems/world-scroll-system.ts
function createWorldScrollSystem(world) {
  return (dt) => {
    world.state.speed = computeSpeed(world.state.playerZ);
    world.state.playerZ += world.state.speed * dt;
    world.addScore(Math.floor(world.state.speed * dt));
  };
}

// src/runtime.ts
function createRuntime(config = {}) {
  const container = createContainer();
  const random = Number.isFinite(config.seed) && config.seed !== void 0 ? mulberry32(Number(config.seed)) : getSystemRandom();
  container.bind(RandomToken).toValue(random);
  container.bind(SimulationInputToken).toFactory(createAgentInput).asSingleton();
  container.bind(SimulationWorldToken).toFactory(createSimulationWorld).withDeps(SimulationInputToken, RandomToken).asSingleton();
  container.bind(PlayerMovementSystemToken).toFactory(createPlayerMovementSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(WorldScrollSystemToken).toFactory(createWorldScrollSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(ObstacleSpawnSystemToken).toFactory(createObstacleSpawnSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(ObstacleDespawnSystemToken).toFactory(createObstacleDespawnSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(ShatterSystemToken).toFactory(createShatterSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(CollisionSystemToken).toFactory(createCollisionSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(OrbSystemToken).toFactory(createOrbSystem).withDeps(SimulationWorldToken).asSingleton();
  const world = container.get(SimulationWorldToken);
  const playerMovementSystem = container.get(PlayerMovementSystemToken);
  const worldScrollSystem = container.get(WorldScrollSystemToken);
  const obstacleSpawnSystem = container.get(ObstacleSpawnSystemToken);
  const shatterSystem = container.get(ShatterSystemToken);
  const collisionSystem = container.get(CollisionSystemToken);
  const orbSystem = container.get(OrbSystemToken);
  const obstacleDespawnSystem = container.get(ObstacleDespawnSystemToken);
  const input = container.get(SimulationInputToken);
  return {
    container,
    reset() {
      world.reset();
    },
    update(dt) {
      worldScrollSystem(dt);
      shatterSystem(dt);
      playerMovementSystem(dt);
      obstacleSpawnSystem(dt);
      orbSystem(dt);
      collisionSystem(dt);
      obstacleDespawnSystem(dt);
    },
    setAction(action) {
      input.setAction(action);
    },
    getState() {
      return world.getState();
    },
    getObservation() {
      return world.getObservation().slice();
    },
    drainEvents() {
      return world.drainEvents();
    }
  };
}

// src/simulation.ts
var ShatterDriftSimulation = class {
  constructor(config = {}) {
    __publicField(this, "config");
    __publicField(this, "runtime");
    this.config = {
      fixedDt: Number.isFinite(config.fixedDt) && config.fixedDt !== void 0 ? Number(config.fixedDt) : null
    };
    this.runtime = createRuntime(config);
  }
  reset() {
    this.runtime.reset();
    return {
      state: this.runtime.getState(),
      events: []
    };
  }
  step(action, dt) {
    const stepDt = this.config.fixedDt ?? (Number.isFinite(dt) ? Number(dt) : DEFAULT_FIXED_DT);
    if (!this.runtime.getState().alive || stepDt <= 0) {
      return {
        state: this.runtime.getState(),
        events: []
      };
    }
    this.runtime.setAction(action);
    this.runtime.update(stepDt);
    return {
      state: this.runtime.getState(),
      events: this.runtime.drainEvents()
    };
  }
  getObservation() {
    return this.runtime.getObservation();
  }
  getState() {
    return this.runtime.getState();
  }
};
export {
  ShatterDriftSimulation
};
