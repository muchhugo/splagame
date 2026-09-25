/**
 * Único ponto de importação do Babylon no jogo, por caminhos PROFUNDOS: o índice raiz
 * de `@babylonjs/core` traz o motor inteiro (7 MB, 1,5 MB gzip). Aqui entra só o que o
 * jogo usa, mais os módulos de efeito colateral que o Babylon exige para recursos
 * opcionais (sem eles o erro só aparece em tempo de execução).
 */
// efeitos colaterais: recursos usados em algum lugar do jogo
import '@babylonjs/core/Rendering/outlineRenderer'; // contorno toon (renderOutline)
import '@babylonjs/core/Meshes/thinInstanceMesh'; // partículas e decoração instanciadas
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture'; // etiquetas/atlas em textura
import '@babylonjs/core/Engines/Extensions/engine.rawTexture'; // atlas de tinta
import '@babylonjs/core/Engines/Extensions/engine.renderTarget'; // retratos do personagem
import '@babylonjs/core/Engines/Extensions/engine.readTexture'; // leitura dos retratos

export { Engine } from '@babylonjs/core/Engines/engine';
export { Constants } from '@babylonjs/core/Engines/constants';
export { Scene } from '@babylonjs/core/scene';
export { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
export { Matrix, Quaternion, Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector';
export { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
export { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
export { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
export { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
export { Effect } from '@babylonjs/core/Materials/effect';
export { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
export { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
export { Texture } from '@babylonjs/core/Materials/Textures/texture';
export { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
export { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
export { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
export { Mesh } from '@babylonjs/core/Meshes/mesh';
export { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
export { TransformNode } from '@babylonjs/core/Meshes/transformNode';
export { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
export { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
export type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
export type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
