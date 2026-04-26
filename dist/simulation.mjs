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
var PHASE_POST_COOLDOWN = 0;
var PHASE_MIN_DURATION = 0;
var PHASE_ACTIVATION_COST = 0.1;
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
var BOOST_MULTIPLIER = 1.4;
var BOOST_DURATION = 1.2;
var BOOST_COOLDOWN = 5;
var BRAKE_MULTIPLIER = 0.65;
var BRAKE_DURATION = 1;
var BRAKE_COOLDOWN = 3;
var SPEED_MOD_LERP_TIME = 0.15;
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
  bindings = /* @__PURE__ */ new Map();
  parent;
  rootResolvingSet;
  resolvingChain;
  destroyed = false;
  constructor(parent, rootResolvingSet, resolvingChain) {
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
var LEGACY = {
  0: { horizontal: 0, shatter: false, boost: false, brake: false },
  1: { horizontal: -1, shatter: false, boost: false, brake: false },
  2: { horizontal: 1, shatter: false, boost: false, brake: false },
  3: { horizontal: 0, shatter: true, boost: false, brake: false },
  4: { horizontal: -1, shatter: true, boost: false, brake: false },
  5: { horizontal: 1, shatter: true, boost: false, brake: false }
};
function decodeAction(action) {
  if (action >= 0 && action <= 5) {
    return LEGACY[action];
  }
  const left = !!(action & 1);
  const right = !!(action & 2);
  const boost = !!(action & 8);
  const brake = !!(action & 16);
  return {
    horizontal: left === right ? 0 : left ? -1 : 1,
    shatter: !!(action & 4),
    // brake wins if both pressed (defensive default)
    boost: boost && !brake,
    brake
  };
}
function createAgentInput() {
  let currentAction = 0;
  return {
    getState() {
      return decodeAction(currentAction);
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
    phaseCooldown: 0,
    phaseMinTimer: 0,
    speed: 0,
    speedMod: 1,
    boostTimer: 0,
    boostCooldown: 0,
    brakeTimer: 0,
    brakeCooldown: 0,
    score: 0,
    alive: true,
    obstacles: [],
    orbs: [],
    nextObstacleZ: 30,
    nextOrbZ: 15,
    lastCloseCallZ: -10,
    nextBossZ: 500,
    // matches BOSS_INTERVAL in bosswaves.ts
    bossCount: 0,
    lastPatternName: null,
    riftFlip: {
      phase: "idle",
      timer: 0,
      nextFlipDistance: 1900
      // first flip ~100m into Cosmic Rift (1800m start)
    }
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
        speedMod: state.speedMod,
        boostCooldown: state.boostCooldown,
        brakeCooldown: state.brakeCooldown,
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
      const energyLock = state.phaseLocked && state.phaseEnergy < PHASE_MIN_THRESHOLD ? (PHASE_MIN_THRESHOLD - state.phaseEnergy) / PHASE_MIN_THRESHOLD : 0;
      const cooldownLock = state.phaseCooldown > 0 ? state.phaseCooldown / PHASE_POST_COOLDOWN : 0;
      observation[3] = clamp(Math.max(energyLock, cooldownLock), 0, 1);
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
        observation[offset + 3] = obstacle.isGate ? 1 : obstacle.halfWidth >= PLAYABLE_HALF_WIDTH * 0.85 ? 0.5 : 0;
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
var SpeedModSystemToken = createToken("SpeedModSystem");
var PlayerMovementSystemToken = createToken("PlayerMovementSystem");
var WorldScrollSystemToken = createToken("WorldScrollSystem");
var ObstacleSpawnSystemToken = createToken("ObstacleSpawnSystem");
var ObstacleDespawnSystemToken = createToken("ObstacleDespawnSystem");
var CollisionSystemToken = createToken("CollisionSystem");
var ShatterSystemToken = createToken("ShatterSystem");
var OrbSystemToken = createToken("OrbSystem");
var BossAnimationSystemToken = createToken("BossAnimationSystem");
var RiftFlipSystemToken = createToken("RiftFlipSystem");

// src/systems/boss-animation-system.ts
function createBossAnimationSystem(world) {
  return (dt) => {
    for (const obstacle of world.state.obstacles) {
      if (!obstacle.bossAnimation || !obstacle.active) continue;
      const anim = obstacle.bossAnimation;
      anim.timer += dt;
      switch (anim.pattern) {
        case "oscillate":
          obstacle.x = anim.baseX + Math.sin(anim.timer * anim.speed + anim.phase) * 3;
          break;
        case "converge": {
          const cycle = (Math.sin(anim.timer * anim.speed + anim.phase) + 1) / 2;
          obstacle.x = anim.baseX * (0.3 + cycle * 0.7);
          break;
        }
        case "static":
          break;
      }
    }
  };
}

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

// src/systems/obstacle-patterns.ts
var weave = {
  name: "weave",
  length: 48,
  obstacleCount: 6,
  emit(rng, _ctx) {
    const startSide = rng() < 0.5 ? -1 : 1;
    const specs = [];
    for (let i = 0; i < 6; i++) {
      const side = startSide * (i % 2 === 0 ? 1 : -1);
      const x = i === 0 ? side * (0.8 + rng() * 0.4) : side * (2 + rng() * 1.5);
      specs.push({ kind: "pillar", dz: i * 8, x, width: 1.2 + rng() * 0.8 });
    }
    return specs;
  }
};
var wallSandwich = {
  name: "wall-sandwich",
  length: 30,
  obstacleCount: 3,
  emit(rng, _ctx) {
    return [
      { kind: "gate", dz: 0, gapX: (rng() - 0.5) * 5 },
      { kind: "phase-wall", dz: 12 },
      { kind: "gate", dz: 24, gapX: (rng() - 0.5) * 5 }
    ];
  }
};
var shotgun = {
  name: "shotgun",
  length: 60,
  // 25 compression + 35 breather built-in
  obstacleCount: 5,
  emit(rng, _ctx) {
    const specs = [];
    for (let i = 0; i < 5; i++) {
      const pick = rng();
      if (pick < 0.5) {
        specs.push({ kind: "pillar", dz: i * 5, x: (rng() - 0.5) * 6 });
      } else if (pick < 0.8) {
        specs.push({ kind: "gate", dz: i * 5, gapX: (rng() - 0.5) * 5 });
      } else {
        specs.push({ kind: "dual-pillar", dz: i * 5 });
      }
    }
    return specs;
  }
};
var crescendo = {
  name: "crescendo",
  length: 115,
  obstacleCount: 8,
  emit(rng, _ctx) {
    const specs = [];
    let dz = 0;
    for (let i = 0; i < 7; i++) {
      const spacing = 20 - 12 * i / 6;
      specs.push({
        kind: rng() < 0.5 ? "pillar" : "gate",
        dz,
        x: (rng() - 0.5) * 6,
        gapX: (rng() - 0.5) * 4
      });
      dz += spacing;
    }
    specs.push({ kind: "phase-wall", dz });
    return specs;
  }
};
var falseSafety = {
  name: "false-safety",
  length: 38,
  obstacleCount: 4,
  emit(rng, _ctx) {
    return [
      { kind: "gate", dz: 0, gapX: (rng() - 0.5) * 5 },
      { kind: "pillar", dz: 10, x: (rng() - 0.5) * 5 },
      { kind: "gate", dz: 20, gapX: (rng() - 0.5) * 5 },
      { kind: "phase-wall", dz: 26 }
      // surprise, 6 units after the gate — tight
    ];
  }
};
var twinGates = {
  name: "twin-gates",
  length: 16,
  obstacleCount: 2,
  emit(rng, _ctx) {
    const offset = 2 + rng() * 1.5;
    const side = rng() < 0.5 ? -1 : 1;
    return [
      { kind: "gate", dz: 0, gapX: side * offset, gapHalfWidth: 2.25 },
      { kind: "gate", dz: 8, gapX: -side * offset, gapHalfWidth: 2.25 }
    ];
  }
};
var PATTERNS = [
  weave,
  wallSandwich,
  shotgun,
  crescendo,
  falseSafety,
  twinGates
];
function pickNextPattern(ctx, rng, lastPatternName) {
  const t = ctx.difficultyT;
  const weights = {
    weave: 0.15 + t * 0.9,
    "wall-sandwich": 0.8 - t * 0.3,
    shotgun: 0.05 + t * 1.2,
    crescendo: 0.05 + t * 1.2,
    "false-safety": 0.3 + t * 0.4,
    "twin-gates": 1 - t * 0.5
  };
  if (ctx.biome === 4) {
    weights["shotgun"] += 0.2;
    weights["crescendo"] += 0.2;
  } else if (ctx.biome === 0) {
    weights["twin-gates"] += 0.3;
    weights["wall-sandwich"] += 0.2;
  }
  if (lastPatternName && weights[lastPatternName] !== void 0) {
    weights[lastPatternName] = 0;
  }
  let total = 0;
  for (const k of Object.keys(weights)) {
    weights[k] = Math.max(0, weights[k]);
    total += weights[k];
  }
  if (total <= 0) return twinGates;
  let r = rng() * total;
  for (const pat of PATTERNS) {
    const w = weights[pat.name] ?? 0;
    if (r < w) return pat;
    r -= w;
  }
  return PATTERNS[PATTERNS.length - 1];
}
function biomeFromDistance(distance) {
  if (distance < 300) return 0;
  if (distance < 700) return 1;
  if (distance < 1200) return 2;
  if (distance < 1800) return 3;
  return 4;
}

// src/systems/obstacle-spawn-system.ts
var BOSS_WAVE_INTERVAL = 500;
function createGate(world, z, gapHalfWidth, gapXOverride) {
  const gapX = gapXOverride ?? (world.random() - 0.5) * 5;
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
function createWideBar(world, z, gapXOverride) {
  const gapSide = world.random() < 0.5 ? -1 : 1;
  const gapX = gapXOverride ?? gapSide * (2 + world.random() * 2);
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
function createPhaseWall(world, z) {
  world.state.obstacles.push({
    z,
    x: 0,
    halfWidth: PLAYABLE_HALF_WIDTH,
    halfHeight: 1.5,
    isGate: false,
    gapX: 0,
    gapHalfWidth: 0,
    active: true,
    partiallyShattered: false,
    passed: false
  });
}
function materializeSpec(world, z, spec) {
  switch (spec.kind) {
    case "gate":
      createGate(world, z, spec.gapHalfWidth ?? 2.25, spec.gapX);
      return;
    case "pillar":
      createPillar(world, z, spec.x, spec.width);
      return;
    case "dual-pillar": {
      const spread = 2 + world.random() * 2;
      const offset = (world.random() - 0.5) * 2;
      createPillar(world, z, offset - spread, 1 + world.random());
      createPillar(world, z, offset + spread, 1 + world.random());
      return;
    }
    case "wide-bar":
      createWideBar(world, z, spec.gapX);
      return;
    case "phase-wall":
      createPhaseWall(world, z);
      return;
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
  ;
  [-6, -2, 2, 6].forEach((zOff, i) => {
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
      passed: false,
      bossAnimation: { pattern: "static", baseX: 0, phase: i * Math.PI / 2, speed: 1.5 + i * 0.3, timer: 0 }
    });
  });
}
function spawnBossConvergingWalls(world, bossZ) {
  for (let row = 0; row < 3; row++) {
    for (const side of [-1, 1]) {
      world.state.obstacles.push({
        z: bossZ + row * 5 - 5,
        x: side * 3,
        halfWidth: 1.5,
        halfHeight: 2,
        isGate: false,
        gapX: 0,
        gapHalfWidth: 0,
        active: true,
        partiallyShattered: false,
        passed: false,
        bossAnimation: { pattern: "converge", baseX: side * 3, phase: row * 1.5, speed: 1.2, timer: 0 }
      });
    }
  }
}
function spawnBossOrbitalRings(world, bossZ) {
  ;
  [-6, -3, 0, 3, 6].forEach((zOff, i) => {
    const baseX = i % 2 === 0 ? -2 : 2;
    world.state.obstacles.push({
      z: bossZ + zOff,
      x: baseX,
      halfWidth: 0.75,
      halfHeight: 1.5,
      isGate: false,
      gapX: 0,
      gapHalfWidth: 0,
      active: true,
      partiallyShattered: false,
      passed: false,
      bossAnimation: { pattern: "oscillate", baseX, phase: i * 1.2, speed: 2, timer: 0 }
    });
  });
}
function spawnBossLaserGrid(world, bossZ) {
  ;
  [-6, -2, 2, 6].forEach((zOff, i) => {
    const x = (world.random() - 0.5) * 4;
    world.state.obstacles.push({
      z: bossZ + zOff,
      x,
      halfWidth: PLAYABLE_HALF_WIDTH,
      halfHeight: 0.4,
      isGate: false,
      gapX: 0,
      gapHalfWidth: 0,
      active: true,
      partiallyShattered: false,
      passed: false,
      bossAnimation: { pattern: "oscillate", baseX: x, phase: i * 2, speed: 1.5, timer: 0 }
    });
  });
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
function emitPattern(world) {
  const startZ = world.state.nextObstacleZ;
  const ctx = {
    playerZ: world.state.playerZ,
    biome: biomeFromDistance(startZ),
    difficultyT: clamp(startZ / 2e3, 0, 1)
  };
  const pattern = pickNextPattern(ctx, world.random, world.state.lastPatternName);
  const specs = pattern.emit(world.random, ctx);
  for (const spec of specs) {
    materializeSpec(world, startZ + spec.dz, spec);
  }
  world.state.lastPatternName = pattern.name;
  world.pushEvent({
    type: "pattern_emitted",
    pattern: pattern.name,
    obstacleCount: specs.length,
    startZ
  });
  const breather = getObstacleSpacing(world) * (1 + world.random());
  return pattern.length + breather;
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
      const advance = emitPattern(world);
      world.state.nextObstacleZ += advance;
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

// src/systems/gravity-flip-scheduler.ts
var RIFT_FLIP_WARNING_DURATION = 1.5;
var RIFT_FLIP_ACTIVE_DURATION = 3;
var RIFT_FLIP_INTERVAL = 150;
var RIFT_FLIP_JITTER = 30;
var COSMIC_RIFT_START_DISTANCE = 1800;
function updateRiftFlip(state, dt, distance, biomeIndex, canTrigger, rng) {
  const events = [];
  if (biomeIndex !== 4 || distance < COSMIC_RIFT_START_DISTANCE) {
    if (state.phase !== "idle") {
      if (state.phase === "active") events.push({ type: "rift_flip_end" });
      state.phase = "idle";
      state.timer = 0;
    }
    state.nextFlipDistance = Math.max(state.nextFlipDistance, COSMIC_RIFT_START_DISTANCE + 100);
    return events;
  }
  state.timer = Math.max(0, state.timer - dt);
  if (state.phase === "idle") {
    const warningTriggerDistance = state.nextFlipDistance - 20;
    if (distance >= warningTriggerDistance && canTrigger) {
      state.phase = "warning";
      state.timer = RIFT_FLIP_WARNING_DURATION;
      events.push({ type: "rift_flip_warning" });
    }
  } else if (state.phase === "warning") {
    if (state.timer <= 0) {
      state.phase = "active";
      state.timer = RIFT_FLIP_ACTIVE_DURATION;
      events.push({ type: "rift_flip_start" });
    }
  } else if (state.phase === "active") {
    if (state.timer <= 0) {
      state.phase = "idle";
      const jitter = (rng() - 0.5) * 2 * RIFT_FLIP_JITTER;
      state.nextFlipDistance = distance + RIFT_FLIP_INTERVAL + jitter;
      events.push({ type: "rift_flip_end" });
    }
  }
  return events;
}

// src/systems/rift-flip-system.ts
function createRiftFlipSystem(world) {
  return (dt) => {
    const biome = biomeFromDistance(world.state.playerZ);
    const canTrigger = !world.state.shattered;
    const events = updateRiftFlip(
      world.state.riftFlip,
      dt,
      world.state.playerZ,
      biome,
      canTrigger,
      world.random
    );
    for (const event of events) {
      world.pushEvent({ type: event.type });
    }
  };
}

// src/systems/shatter-system.ts
function createShatterSystem(world) {
  return (dt) => {
    if (!world.state.alive) {
      world.state.shattered = false;
      world.state.phaseMinTimer = 0;
      return;
    }
    const input = world.input.getState();
    const wasShattered = world.state.shattered;
    if (world.state.phaseCooldown > 0) {
      world.state.phaseCooldown = Math.max(0, world.state.phaseCooldown - dt);
    }
    if (world.state.phaseMinTimer > 0) {
      world.state.phaseMinTimer = Math.max(0, world.state.phaseMinTimer - dt);
    }
    const wantsToShatter = input.shatter && !world.state.phaseLocked && world.state.phaseCooldown <= 0;
    const forcedByMinTimer = world.state.phaseMinTimer > 0 && !world.state.phaseLocked;
    const isPhasing = (wantsToShatter || forcedByMinTimer) && world.state.phaseEnergy > 0;
    if (isPhasing) {
      world.state.phaseEnergy = Math.max(0, world.state.phaseEnergy - PHASE_DRAIN_RATE * dt);
    } else {
      world.state.phaseEnergy = Math.min(1, world.state.phaseEnergy + PHASE_RECHARGE_RATE * dt);
    }
    if (world.state.phaseEnergy <= 0) {
      world.state.phaseEnergy = 0;
      world.state.phaseLocked = true;
      world.state.phaseMinTimer = 0;
      world.state.shattered = false;
    } else if (world.state.phaseLocked && world.state.phaseEnergy >= PHASE_MIN_THRESHOLD) {
      world.state.phaseLocked = false;
    }
    world.state.shattered = isPhasing && !world.state.phaseLocked && world.state.phaseEnergy > 0;
    if (wasShattered && !world.state.shattered) {
      world.state.phaseCooldown = PHASE_POST_COOLDOWN;
    }
    if (world.state.shattered && !wasShattered) {
      world.state.phaseEnergy = Math.max(0, world.state.phaseEnergy - PHASE_ACTIVATION_COST);
      world.state.phaseMinTimer = PHASE_MIN_DURATION;
      if (world.state.phaseEnergy <= 0) {
        world.state.phaseEnergy = 0;
        world.state.phaseLocked = true;
        world.state.phaseMinTimer = 0;
        world.state.shattered = false;
      }
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

// src/systems/speed-mod-system.ts
function createSpeedModSystem(world) {
  return (dt) => {
    const input = world.input.getState();
    const s = world.state;
    if (s.boostTimer > 0) {
      s.boostTimer = Math.max(0, s.boostTimer - dt);
      if (s.boostTimer === 0) s.boostCooldown = BOOST_COOLDOWN;
    }
    if (s.brakeTimer > 0) {
      s.brakeTimer = Math.max(0, s.brakeTimer - dt);
      if (s.brakeTimer === 0) s.brakeCooldown = BRAKE_COOLDOWN;
    }
    if (s.boostCooldown > 0) s.boostCooldown = Math.max(0, s.boostCooldown - dt);
    if (s.brakeCooldown > 0) s.brakeCooldown = Math.max(0, s.brakeCooldown - dt);
    if (input.brake && s.brakeTimer === 0 && s.brakeCooldown === 0) {
      s.brakeTimer = BRAKE_DURATION;
      s.boostTimer = 0;
    } else if (input.boost && s.boostTimer === 0 && s.boostCooldown === 0) {
      s.boostTimer = BOOST_DURATION;
      s.brakeTimer = 0;
    }
    let target = 1;
    if (s.brakeTimer > 0) target = BRAKE_MULTIPLIER;
    else if (s.boostTimer > 0) target = BOOST_MULTIPLIER;
    const lerpFactor = 1 - Math.exp(-dt / SPEED_MOD_LERP_TIME);
    s.speedMod += (target - s.speedMod) * lerpFactor;
  };
}

// src/systems/world-scroll-system.ts
function createWorldScrollSystem(world) {
  return (dt) => {
    world.state.speed = computeSpeed(world.state.playerZ) * world.state.speedMod;
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
  container.bind(SpeedModSystemToken).toFactory(createSpeedModSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(PlayerMovementSystemToken).toFactory(createPlayerMovementSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(WorldScrollSystemToken).toFactory(createWorldScrollSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(ObstacleSpawnSystemToken).toFactory(createObstacleSpawnSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(ObstacleDespawnSystemToken).toFactory(createObstacleDespawnSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(ShatterSystemToken).toFactory(createShatterSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(CollisionSystemToken).toFactory(createCollisionSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(OrbSystemToken).toFactory(createOrbSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(BossAnimationSystemToken).toFactory(createBossAnimationSystem).withDeps(SimulationWorldToken).asSingleton();
  container.bind(RiftFlipSystemToken).toFactory(createRiftFlipSystem).withDeps(SimulationWorldToken).asSingleton();
  const world = container.get(SimulationWorldToken);
  const speedModSystem = container.get(SpeedModSystemToken);
  const playerMovementSystem = container.get(PlayerMovementSystemToken);
  const worldScrollSystem = container.get(WorldScrollSystemToken);
  const obstacleSpawnSystem = container.get(ObstacleSpawnSystemToken);
  const shatterSystem = container.get(ShatterSystemToken);
  const collisionSystem = container.get(CollisionSystemToken);
  const orbSystem = container.get(OrbSystemToken);
  const obstacleDespawnSystem = container.get(ObstacleDespawnSystemToken);
  const bossAnimationSystem = container.get(BossAnimationSystemToken);
  const riftFlipSystem = container.get(RiftFlipSystemToken);
  const input = container.get(SimulationInputToken);
  return {
    container,
    reset() {
      world.reset();
    },
    update(dt) {
      speedModSystem(dt);
      worldScrollSystem(dt);
      shatterSystem(dt);
      playerMovementSystem(dt);
      obstacleSpawnSystem(dt);
      bossAnimationSystem(dt);
      orbSystem(dt);
      collisionSystem(dt);
      obstacleDespawnSystem(dt);
      riftFlipSystem(dt);
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
  config;
  runtime;
  constructor(config = {}) {
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
