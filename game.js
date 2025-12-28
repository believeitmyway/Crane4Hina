import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Global Variables
let scene, camera, renderer;
let world;
let lastTime;
let crane;
let prize;

// Physics Settings
const TIME_STEP = 1 / 60;

// Game Logic Variables
let gameState = 'IDLE';
const GAME_CONFIG = {
    maxX: 1.8, minX: -1.8,
    maxZ: 1.8, minZ: -1.8,
    startX: -1.5, startZ: 1.5,
    moveSpeed: 1.0,
    dropHeight: 2.0,
    liftHeight: 0.1,
};
let inputState = { right: false, up: false };

// Initialize
function init() {
    // --- 1. Three.js Setup ---
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x202020);
    scene.fog = new THREE.Fog(0x202020, 10, 50);

    // Camera
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 3, 6);
    camera.lookAt(0, 1, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;
    scene.add(dirLight);

    // --- 2. Cannon-es Setup ---
    world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;

    // Contact Materials
    const defaultMaterial = new CANNON.Material('default');
    const defaultContactMaterial = new CANNON.ContactMaterial(defaultMaterial, defaultMaterial, {
        friction: 0.3,
        restitution: 0.3,
    });
    world.addContactMaterial(defaultContactMaterial);

    // --- 3. Create Objects ---
    createEnvironment();
    createCrane();
    createPrize();
    initGameLogic();

    // Handle Resize
    window.addEventListener('resize', onWindowResize);

    // Start Loop
    lastTime = performance.now();
    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const dt = (time - lastTime) / 1000;
    lastTime = time;

    // Step Physics
    world.step(TIME_STEP, dt, 3);

    // Game Logic
    updateGameLogic(dt);

    // Sync Visuals
    scene.traverse((child) => {
        if (child.userData.physicsBody) {
            child.position.copy(child.userData.physicsBody.position);
            child.quaternion.copy(child.userData.physicsBody.quaternion);
        }
    });

    if (crane) crane.update(dt);
    if (prize) prize.update();

    // Render
    renderer.render(scene, camera);
}

// --- Helper: Create Physics + Visual Object ---
function createBody(shape, mass, position, material, color) {
    const body = new CANNON.Body({ mass: mass, shape: shape, material: material });
    body.position.copy(position);
    world.addBody(body);

    let geometry;
    if (shape.type === CANNON.Shape.types.BOX) {
        geometry = new THREE.BoxGeometry(shape.halfExtents.x * 2, shape.halfExtents.y * 2, shape.halfExtents.z * 2);
    } else if (shape.type === CANNON.Shape.types.SPHERE) {
        geometry = new THREE.SphereGeometry(shape.radius, 32, 32);
    } else if (shape.type === CANNON.Shape.types.CYLINDER) {
        geometry = new THREE.CylinderGeometry(shape.radiusTop, shape.radiusBottom, shape.height, 32);
    }

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: color }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.physicsBody = body;
    scene.add(mesh);

    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);

    return { mesh, body };
}

// --- Environment Setup ---
function createEnvironment() {
    const wallMaterial = new CANNON.Material('wall');
    const floorMaterial = new CANNON.Material('floor');

    const wallContact = new CANNON.ContactMaterial(wallMaterial, floorMaterial, { friction: 0.1, restitution: 0.0 });
    world.addContactMaterial(wallContact);

    // Floor
    const platformShape = new CANNON.Box(new CANNON.Vec3(2, 0.1, 2));
    const { mesh: floorMesh } = createBody(platformShape, 0, new CANNON.Vec3(0, -0.1, 0), floorMaterial, 0xeeeeee);
    floorMesh.receiveShadow = true;
    // Remove initial floor to make hole
    scene.remove(floorMesh);
    world.removeBody(floorMesh.userData.physicsBody);

    // Walls
    const wallShapeSide = new CANNON.Box(new CANNON.Vec3(0.05, 1.5, 2));
    const wallShapeBack = new CANNON.Box(new CANNON.Vec3(2, 1.5, 0.05));

    const { mesh: leftWall } = createBody(wallShapeSide, 0, new CANNON.Vec3(-2.05, 1.5, 0), wallMaterial, 0x88ccff);
    leftWall.material = new THREE.MeshPhysicalMaterial({ color: 0x88ccff, transmission: 0.9, opacity: 1, transparent: true });

    const { mesh: rightWall } = createBody(wallShapeSide, 0, new CANNON.Vec3(2.05, 1.5, 0), wallMaterial, 0x88ccff);
    rightWall.material = leftWall.material;

    const { mesh: backWall } = createBody(wallShapeBack, 0, new CANNON.Vec3(0, 1.5, -2.05), wallMaterial, 0x88ccff);
    backWall.material = leftWall.material;

    const { mesh: frontWall } = createBody(wallShapeBack, 0, new CANNON.Vec3(0, 1.5, 2.05), wallMaterial, 0x88ccff);
    frontWall.material = leftWall.material;

    // Floor Sections (Hole at Front-Right)
    // Section 1: Back strip
    const backFloorShape = new CANNON.Box(new CANNON.Vec3(2, 0.1, 1.4));
    createBody(backFloorShape, 0, new CANNON.Vec3(0, -0.1, -0.6), floorMaterial, 0xffcccc);

    // Section 2: Front-Left (Solid)
    const frontLeftShape = new CANNON.Box(new CANNON.Vec3(1.4, 0.1, 0.4));
    createBody(frontLeftShape, 0, new CANNON.Vec3(-0.6, -0.1, 1.2), floorMaterial, 0xffcccc);

    // Hole Visual
    const holeTriggerGeo = new THREE.PlaneGeometry(1.2, 0.8);
    const holeTriggerMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const holeMesh = new THREE.Mesh(holeTriggerGeo, holeTriggerMat);
    holeMesh.rotation.x = -Math.PI / 2;
    holeMesh.position.set(1.4, -0.09, 1.2);
    scene.add(holeMesh);
}

// --- Crane Implementation ---
class Crane {
    constructor() {
        this.basePosition = new CANNON.Vec3(0, 2.5, 0);
        this.bodies = [];
        this.meshes = [];
        this.constraints = [];

        this.material = new CANNON.Material('crane');
        const craneContact = new CANNON.ContactMaterial(this.material, this.material, { friction: 0.1, restitution: 0.0 });
        world.addContactMaterial(craneContact);

        // Carriage
        const carriageShape = new CANNON.Box(new CANNON.Vec3(0.4, 0.1, 0.4));
        this.carriageBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, position: this.basePosition });
        this.carriageBody.addShape(carriageShape);
        world.addBody(this.carriageBody);

        const carriageGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 32);
        const carriageMesh = new THREE.Mesh(carriageGeo, new THREE.MeshStandardMaterial({ color: 0xffdddd }));
        scene.add(carriageMesh);
        this.link(this.carriageBody, carriageMesh);

        // Head
        this.headBody = new CANNON.Body({ mass: 10, position: new CANNON.Vec3(0, 2.2, 0) });
        this.headBody.linearDamping = 0.9;
        this.headBody.angularDamping = 0.9;
        const headShape = new CANNON.Cylinder(0.3, 0.3, 0.4, 16);
        const q = new CANNON.Quaternion();
        q.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/2);
        this.headBody.addShape(headShape, new CANNON.Vec3(0,0,0), q);
        world.addBody(this.headBody);

        const headMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.4, 32), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        scene.add(headMesh);
        this.link(this.headBody, headMesh);

        // Cord (Spring)
        this.cord = new CANNON.Spring(this.carriageBody, this.headBody, {
            localAnchorA: new CANNON.Vec3(0, 0, 0),
            localAnchorB: new CANNON.Vec3(0, 0.3, 0),
            restLength: 0.1,
            stiffness: 100,
            damping: 5,
        });
        world.addEventListener('postStep', () => {
            this.cord.applyForce();
        });

        // Claws
        this.leftClaw = this.createClawPart(new CANNON.Vec3(-0.35, 2.0, 0), true);
        this.rightClaw = this.createClawPart(new CANNON.Vec3(0.35, 2.0, 0), false);

        // Motors
        this.motorLeft = new CANNON.HingeConstraint(this.headBody, this.leftClaw.body, {
            pivotA: new CANNON.Vec3(-0.25, -0.2, 0),
            pivotB: new CANNON.Vec3(0, 0.4, 0),
            axisA: new CANNON.Vec3(0, 0, 1),
            axisB: new CANNON.Vec3(0, 0, 1),
        });
        this.motorLeft.enableMotor();
        world.addConstraint(this.motorLeft);

        this.motorRight = new CANNON.HingeConstraint(this.headBody, this.rightClaw.body, {
            pivotA: new CANNON.Vec3(0.25, -0.2, 0),
            pivotB: new CANNON.Vec3(0, 0.4, 0),
            axisA: new CANNON.Vec3(0, 0, 1),
            axisB: new CANNON.Vec3(0, 0, 1),
        });
        this.motorRight.enableMotor();
        world.addConstraint(this.motorRight);

        this.motorSpeed = 2;
    }

    createClawPart(position, isLeft) {
        const mass = 1;
        const body = new CANNON.Body({ mass: mass, material: this.material });
        body.position.copy(position);

        const upperShape = new CANNON.Box(new CANNON.Vec3(0.05, 0.4, 0.05));
        body.addShape(upperShape, new CANNON.Vec3(0, 0, 0));

        const lowerShape = new CANNON.Box(new CANNON.Vec3(0.05, 0.25, 0.05));
        const q = new CANNON.Quaternion();
        const angle = isLeft ? -Math.PI / 4 : Math.PI / 4;
        q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), angle);
        body.addShape(lowerShape, new CANNON.Vec3(isLeft ? 0.15 : -0.15, -0.5, 0), q);

        world.addBody(body);

        const container = new THREE.Group();

        const upperGeo = new THREE.BoxGeometry(0.1, 0.8, 0.1);
        const upperMesh = new THREE.Mesh(upperGeo, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
        container.add(upperMesh);

        const lowerGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1);
        const lowerMesh = new THREE.Mesh(lowerGeo, new THREE.MeshStandardMaterial({ color: 0xffaaaa }));
        lowerMesh.position.set(isLeft ? 0.15 : -0.15, -0.5, 0);
        lowerMesh.rotation.z = angle;
        container.add(lowerMesh);

        scene.add(container);
        this.link(body, container);

        return { body, mesh: container };
    }

    link(body, mesh) {
        this.bodies.push(body);
        this.meshes.push(mesh);
    }

    update(dt) {
        for (let i = 0; i < this.bodies.length; i++) {
            this.meshes[i].position.copy(this.bodies[i].position);
            this.meshes[i].quaternion.copy(this.bodies[i].quaternion);
        }
    }

    setTargetPosition(x, z) {
        this.carriageBody.position.x = x;
        this.carriageBody.position.z = z;
    }

    setHeight(length) {
        this.cord.restLength = length;
    }

    openClaws() {
        this.motorLeft.setMotorSpeed(this.motorSpeed);
        this.motorRight.setMotorSpeed(-this.motorSpeed);
    }

    closeClaws() {
        this.motorLeft.setMotorSpeed(-this.motorSpeed);
        this.motorRight.setMotorSpeed(this.motorSpeed);
    }

    stopMotors() {
         this.motorLeft.setMotorSpeed(0);
         this.motorRight.setMotorSpeed(0);
    }
}

function createCrane() {
    crane = new Crane();
}

// --- Prize Implementation (Gengar-themed) ---
class Prize {
    constructor() {
        this.bodies = [];
        this.meshes = [];
        this.material = new CANNON.Material('prize');

        if (crane) {
             const prizeCraneContact = new CANNON.ContactMaterial(this.material, crane.material, {
                 friction: 1.0,
                 restitution: 0.1,
                 contactEquationStiffness: 1e6,
             });
             world.addContactMaterial(prizeCraneContact);
        }

        const mass = 2;
        this.mainBody = new CANNON.Body({ mass: mass, material: this.material });
        this.mainBody.linearDamping = 0.5;
        this.mainBody.angularDamping = 0.5;
        this.mainBody.position.set(0.5, 0.5, 0.5);

        const mainShape = new CANNON.Sphere(0.3);
        this.mainBody.addShape(mainShape);

        const earShape = new CANNON.Sphere(0.1);
        this.mainBody.addShape(earShape, new CANNON.Vec3(-0.2, 0.25, 0));
        this.mainBody.addShape(earShape, new CANNON.Vec3(0.2, 0.25, 0));

        const spikeShape = new CANNON.Sphere(0.15);
        this.mainBody.addShape(spikeShape, new CANNON.Vec3(0, -0.1, -0.25));

        world.addBody(this.mainBody);

        const container = new THREE.Group();

        const mainGeo = new THREE.SphereGeometry(0.3, 32, 32);
        const mainMat = new THREE.MeshStandardMaterial({
            color: 0x663399,
            roughness: 1.0,
            metalness: 0.0
        });
        const mainMesh = new THREE.Mesh(mainGeo, mainMat);
        mainMesh.castShadow = true;
        container.add(mainMesh);

        const earGeo = new THREE.ConeGeometry(0.1, 0.2, 16);
        const leftEar = new THREE.Mesh(earGeo, mainMat);
        leftEar.position.set(-0.2, 0.3, 0);
        leftEar.rotation.z = Math.PI / 6;
        container.add(leftEar);

        const rightEar = new THREE.Mesh(earGeo, mainMat);
        rightEar.position.set(0.2, 0.3, 0);
        rightEar.rotation.z = -Math.PI / 6;
        container.add(rightEar);

        const eyeGeo = new THREE.SphereGeometry(0.06, 16, 16);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffaaaa });
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.1, 0.05, 0.25);
        container.add(leftEye);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.1, 0.05, 0.25);
        container.add(rightEye);

        scene.add(container);
        this.link(this.mainBody, container);
    }

    link(body, mesh) {
        this.bodies.push(body);
        this.meshes.push(mesh);
    }

    update() {
         for (let i = 0; i < this.bodies.length; i++) {
            this.meshes[i].position.copy(this.bodies[i].position);
            this.meshes[i].quaternion.copy(this.bodies[i].quaternion);
        }
    }
}

function createPrize() {
    prize = new Prize();
}

// --- Game Logic ---
function initGameLogic() {
    window.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') inputState.right = true;
        if (e.key === 'ArrowUp') inputState.up = true;
    });
    window.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowRight') inputState.right = false;
        if (e.key === 'ArrowUp') inputState.up = false;
    });
    if (crane) crane.setTargetPosition(GAME_CONFIG.startX, GAME_CONFIG.startZ);
}

function updateGameLogic(dt) {
    if (!crane) return;
    const pos = crane.carriageBody.position;

    switch (gameState) {
        case 'IDLE':
            if (inputState.right) gameState = 'MOVE_X';
            break;
        case 'MOVE_X':
            if (inputState.right && pos.x < GAME_CONFIG.maxX) {
                crane.setTargetPosition(pos.x + GAME_CONFIG.moveSpeed * dt, pos.z);
            } else {
                gameState = 'WAIT_Z';
            }
            break;
        case 'WAIT_Z':
            if (inputState.up) gameState = 'MOVE_Z';
            break;
        case 'MOVE_Z':
            if (inputState.up && pos.z > GAME_CONFIG.minZ) {
                crane.setTargetPosition(pos.x, pos.z - GAME_CONFIG.moveSpeed * dt);
            } else {
                gameState = 'READY';
                startAutoSequence();
            }
            break;
    }
}

function startAutoSequence() {
    gameState = 'OPENING';
    crane.openClaws();
    setTimeout(() => {
        gameState = 'DROPPING';
        crane.stopMotors();
        crane.setHeight(GAME_CONFIG.dropHeight);
        setTimeout(() => {
            gameState = 'GRABBING';
            crane.closeClaws();
            setTimeout(() => {
                gameState = 'RISING';
                crane.setHeight(GAME_CONFIG.liftHeight);
                setTimeout(() => {
                    gameState = 'RETURNING';
                    returnToHole();
                }, 2000);
            }, 2000);
        }, 2000);
    }, 1000);
}

function returnToHole() {
    const targetX = 1.4, targetZ = 1.2;
    const duration = 3000;
    const startX = crane.carriageBody.position.x;
    const startZ = crane.carriageBody.position.z;
    let startTime = performance.now();

    function moveLoop() {
        const now = performance.now();
        const t = Math.min((now - startTime) / duration, 1);
        const newX = startX + (targetX - startX) * t;
        const newZ = startZ + (targetZ - startZ) * t;
        crane.setTargetPosition(newX, newZ);
        if (t < 1) {
            requestAnimationFrame(moveLoop);
        } else {
            gameState = 'DROP';
            crane.openClaws();
            setTimeout(resetGame, 2000);
        }
    }
    moveLoop();
}

function resetGame() {
    gameState = 'RESET';
    crane.closeClaws();
    inputState.right = false; inputState.up = false;
    const targetX = GAME_CONFIG.startX, targetZ = GAME_CONFIG.startZ;
    const duration = 2000;
    const startX = crane.carriageBody.position.x, startZ = crane.carriageBody.position.z;
    let startTime = performance.now();

    function resetLoop() {
         const now = performance.now();
        const t = Math.min((now - startTime) / duration, 1);
        const newX = startX + (targetX - startX) * t;
        const newZ = startZ + (targetZ - startZ) * t;
        crane.setTargetPosition(newX, newZ);
        if (t < 1) requestAnimationFrame(resetLoop);
        else gameState = 'IDLE';
    }
    resetLoop();
}

// Start
init();
