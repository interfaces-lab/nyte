export const CANVAS_LIBRARY_VERSIONS = {
  three: "0.186.1",
  "d3-array": "3.2.4",
  "d3-scale": "4.0.2",
  "d3-shape": "3.2.0",
  "d3-hierarchy": "3.1.2",
  "d3-force": "3.0.0",
  "@nivo/bar": "0.99.0",
  "@nivo/boxplot": "0.99.0",
  "@nivo/bullet": "0.99.0",
  "@nivo/bump": "0.99.0",
  "@nivo/calendar": "0.99.0",
  "@nivo/chord": "0.99.0",
  "@nivo/circle-packing": "0.99.0",
  "@nivo/funnel": "0.99.0",
  "@nivo/geo": "0.99.0",
  "@nivo/heatmap": "0.99.0",
  "@nivo/icicle": "0.99.0",
  "@nivo/line": "0.99.0",
  "@nivo/marimekko": "0.99.0",
  "@nivo/network": "0.99.0",
  "@nivo/parallel-coordinates": "0.99.0",
  "@nivo/pie": "0.99.0",
  "@nivo/polar-bar": "0.99.0",
  "@nivo/radar": "0.99.0",
  "@nivo/radial-bar": "0.99.0",
  "@nivo/sankey": "0.99.0",
  "@nivo/scatterplot": "0.99.0",
  "@nivo/stream": "0.99.0",
  "@nivo/sunburst": "0.99.0",
  "@nivo/swarmplot": "0.99.0",
  "@nivo/tree": "0.99.0",
  "@nivo/treemap": "0.99.0",
  "@nivo/voronoi": "0.99.0",
  "@nivo/waffle": "0.99.0",
} as const;

export const CANVAS_LIBRARY_EXPORTS = {
  three:
    "ACESFilmicToneMapping AddEquation AddOperation AdditiveAnimationBlendMode AdditiveBlending AgXToneMapping AlphaFormat AlwaysCompare AlwaysDepth AlwaysStencilFunc AmbientLight AnimationAction AnimationClip AnimationLoader AnimationMixer AnimationObjectGroup AnimationUtils ArcCurve ArrayCamera ArrowHelper AttachedBindMode Audio AudioAnalyser AudioContext AudioListener AudioLoader AxesHelper BackSide BasicDepthPacking BasicShadowMap BatchedMesh BezierInterpolant Bone BooleanKeyframeTrack Box2 Box3 Box3Helper BoxGeometry BoxHelper BufferAttribute BufferGeometry BufferGeometryLoader ByteType Cache Camera CameraHelper CanvasTexture CapsuleGeometry CatmullRomCurve3 CineonToneMapping CircleGeometry ClampToEdgeWrapping Clock Color ColorKeyframeTrack ColorManagement Compatibility CompressedArrayTexture CompressedCubeTexture CompressedTexture CompressedTextureLoader ConeGeometry ConstantAlphaFactor ConstantColorFactor Controls CubeCamera CubeDepthTexture CubeReflectionMapping CubeRefractionMapping CubeTexture CubeTextureLoader CubeUVReflectionMapping CubicBezierCurve CubicBezierCurve3 CubicInterpolant CullFaceBack CullFaceFront CullFaceFrontBack CullFaceNone Curve CurvePath CustomBlending CustomToneMapping CylinderGeometry Cylindrical Data3DTexture DataArrayTexture DataTexture DataTextureLoader DataUtils DecrementStencilOp DecrementWrapStencilOp DefaultLoadingManager DepthFormat DepthStencilFormat DepthTexture DetachedBindMode DirectionalLight DirectionalLightHelper DiscreteInterpolant DodecahedronGeometry DoubleSide DstAlphaFactor DstColorFactor DynamicCopyUsage DynamicDrawUsage DynamicReadUsage EdgesGeometry EllipseCurve EqualCompare EqualDepth EqualStencilFunc EquirectangularReflectionMapping EquirectangularRefractionMapping Euler EventDispatcher ExternalTexture ExtrudeGeometry FileLoader Float16BufferAttribute Float32BufferAttribute FloatType Fog FogExp2 FramebufferTexture FrontSide Frustum FrustumArray GLBufferAttribute GLSL1 GLSL3 GreaterCompare GreaterDepth GreaterEqualCompare GreaterEqualDepth GreaterEqualStencilFunc GreaterStencilFunc GridHelper Group HTMLTexture HalfFloatType HemisphereLight HemisphereLightHelper IcosahedronGeometry ImageBitmapLoader ImageLoader ImageUtils IncrementStencilOp IncrementWrapStencilOp InstancedBufferAttribute InstancedBufferGeometry InstancedInterleavedBuffer InstancedMesh Int16BufferAttribute Int32BufferAttribute Int8BufferAttribute IntType InterleavedBuffer InterleavedBufferAttribute Interpolant InterpolateBezier InterpolateDiscrete InterpolateLinear InterpolateSmooth InterpolationSamplingMode InterpolationSamplingType InvertStencilOp KeepStencilOp KeyframeTrack LOD LatheGeometry Layers LessCompare LessDepth LessEqualCompare LessEqualDepth LessEqualStencilFunc LessStencilFunc Light LightProbe LightShadow Line Line3 LineBasicMaterial LineCurve LineCurve3 LineDashedMaterial LineLoop LineSegments LinearFilter LinearInterpolant LinearMipMapLinearFilter LinearMipMapNearestFilter LinearMipmapLinearFilter LinearMipmapNearestFilter LinearSRGBColorSpace LinearToneMapping LinearTransfer Loader LoaderUtils LoadingManager LoopOnce LoopPingPong LoopRepeat MOUSE Material MaterialBlending MaterialLoader MathUtils Matrix2 Matrix3 Matrix4 MaxEquation Mesh MeshBasicMaterial MeshDepthMaterial MeshDistanceMaterial MeshLambertMaterial MeshMatcapMaterial MeshNormalMaterial MeshPhongMaterial MeshPhysicalMaterial MeshStandardMaterial MeshToonMaterial MinEquation MirroredRepeatWrapping MixOperation MultiplyBlending MultiplyOperation NearestFilter NearestMipMapLinearFilter NearestMipMapNearestFilter NearestMipmapLinearFilter NearestMipmapNearestFilter NeutralToneMapping NeverCompare NeverDepth NeverStencilFunc NoBlending NoColorSpace NoNormalPacking NoToneMapping NormalAnimationBlendMode NormalBlending NormalGAPacking NormalRGPacking NotEqualCompare NotEqualDepth NotEqualStencilFunc NumberKeyframeTrack Object3D ObjectLoader ObjectSpaceNormalMap OctahedronGeometry OneFactor OneMinusConstantAlphaFactor OneMinusConstantColorFactor OneMinusDstAlphaFactor OneMinusDstColorFactor OneMinusSrcAlphaFactor OneMinusSrcColorFactor OrthographicCamera PCFShadowMap PCFSoftShadowMap PMREMGenerator Path PerspectiveCamera Plane PlaneGeometry PlaneHelper PointLight PointLightHelper Points PointsMaterial PolarGridHelper PolyhedronGeometry PositionalAudio PropertyBinding PropertyMixer QuadraticBezierCurve QuadraticBezierCurve3 Quaternion QuaternionKeyframeTrack QuaternionLinearInterpolant R11_EAC_Format RED_GREEN_RGTC2_Format RED_RGTC1_Format REVISION RG11_EAC_Format RGBADepthPacking RGBAFormat RGBAIntegerFormat RGBA_ASTC_10x10_Format RGBA_ASTC_10x5_Format RGBA_ASTC_10x6_Format RGBA_ASTC_10x8_Format RGBA_ASTC_12x10_Format RGBA_ASTC_12x12_Format RGBA_ASTC_4x4_Format RGBA_ASTC_5x4_Format RGBA_ASTC_5x5_Format RGBA_ASTC_6x5_Format RGBA_ASTC_6x6_Format RGBA_ASTC_8x5_Format RGBA_ASTC_8x6_Format RGBA_ASTC_8x8_Format RGBA_BPTC_Format RGBA_ETC2_EAC_Format RGBA_PVRTC_2BPPV1_Format RGBA_PVRTC_4BPPV1_Format RGBA_S3TC_DXT1_Format RGBA_S3TC_DXT3_Format RGBA_S3TC_DXT5_Format RGBDepthPacking RGBFormat RGBIntegerFormat RGB_BPTC_SIGNED_Format RGB_BPTC_UNSIGNED_Format RGB_ETC1_Format RGB_ETC2_Format RGB_PVRTC_2BPPV1_Format RGB_PVRTC_4BPPV1_Format RGB_S3TC_DXT1_Format RGDepthPacking RGFormat RGIntegerFormat RawShaderMaterial Ray Raycaster RectAreaLight RedFormat RedIntegerFormat ReinhardToneMapping RenderObjectRefreshType RenderTarget RenderTarget3D RepeatWrapping ReplaceStencilOp ReverseSubtractEquation RingGeometry SIGNED_R11_EAC_Format SIGNED_RED_GREEN_RGTC2_Format SIGNED_RED_RGTC1_Format SIGNED_RG11_EAC_Format SRGBColorSpace SRGBTransfer Scene ShaderChunk ShaderLib ShaderMaterial ShadowMaterial Shape ShapeGeometry ShapePath ShapeUtils ShortType Skeleton SkeletonHelper SkinnedMesh Source Sphere SphereGeometry Spherical SphericalHarmonics3 SplineCurve SpotLight SpotLightHelper Sprite SpriteMaterial SrcAlphaFactor SrcAlphaSaturateFactor SrcColorFactor StaticCopyUsage StaticDrawUsage StaticReadUsage StereoCamera StreamCopyUsage StreamDrawUsage StreamReadUsage StringKeyframeTrack SubtractEquation SubtractiveBlending TOUCH TangentSpaceNormalMap TetrahedronGeometry Texture TextureLoader TextureSource TextureUtils Timer TimestampQuery TorusGeometry TorusKnotGeometry Triangle TriangleFanDrawMode TriangleStripDrawMode TrianglesDrawMode TubeGeometry UVMapping Uint16BufferAttribute Uint32BufferAttribute Uint8BufferAttribute Uint8ClampedBufferAttribute Uniform UniformsGroup UniformsLib UniformsUtils UnsignedByteType UnsignedInt101111Type UnsignedInt248Type UnsignedInt5999Type UnsignedIntType UnsignedShort4444Type UnsignedShort5551Type UnsignedShortType VSMShadowMap Vector2 Vector3 Vector4 VectorKeyframeTrack VideoFrameTexture VideoTexture WebGL3DRenderTarget WebGLArrayRenderTarget WebGLCoordinateSystem WebGLCubeRenderTarget WebGLRenderTarget WebGLRenderer WebGLUtils WebGPUCoordinateSystem WebXRController WireframeGeometry WrapAroundEnding ZeroCurvatureEnding ZeroFactor ZeroSlopeEnding ZeroStencilOp createCanvasElement error getConsoleFunction log setConsoleFunction warn warnOnce",
  "d3-array":
    "Adder InternMap InternSet ascending bin bisect bisectCenter bisectLeft bisectRight bisector blur blur2 blurImage count cross cumsum descending deviation difference disjoint every extent fcumsum filter flatGroup flatRollup fsum greatest greatestIndex group groupSort groups histogram index indexes intersection least leastIndex map max maxIndex mean median medianIndex merge min minIndex mode nice pairs permute quantile quantileIndex quantileSorted quickselect range rank reduce reverse rollup rollups scan shuffle shuffler some sort subset sum superset thresholdFreedmanDiaconis thresholdScott thresholdSturges tickIncrement tickStep ticks transpose union variance zip",
  "d3-scale":
    "scaleBand scaleDiverging scaleDivergingLog scaleDivergingPow scaleDivergingSqrt scaleDivergingSymlog scaleIdentity scaleImplicit scaleLinear scaleLog scaleOrdinal scalePoint scalePow scaleQuantile scaleQuantize scaleRadial scaleSequential scaleSequentialLog scaleSequentialPow scaleSequentialQuantile scaleSequentialSqrt scaleSequentialSymlog scaleSqrt scaleSymlog scaleThreshold scaleTime scaleUtc tickFormat",
  "d3-shape":
    "arc area areaRadial curveBasis curveBasisClosed curveBasisOpen curveBumpX curveBumpY curveBundle curveCardinal curveCardinalClosed curveCardinalOpen curveCatmullRom curveCatmullRomClosed curveCatmullRomOpen curveLinear curveLinearClosed curveMonotoneX curveMonotoneY curveNatural curveStep curveStepAfter curveStepBefore line lineRadial link linkHorizontal linkRadial linkVertical pie pointRadial radialArea radialLine stack stackOffsetDiverging stackOffsetExpand stackOffsetNone stackOffsetSilhouette stackOffsetWiggle stackOrderAppearance stackOrderAscending stackOrderDescending stackOrderInsideOut stackOrderNone stackOrderReverse symbol symbolAsterisk symbolCircle symbolCross symbolDiamond symbolDiamond2 symbolPlus symbolSquare symbolSquare2 symbolStar symbolTimes symbolTriangle symbolTriangle2 symbolWye symbolX symbols symbolsFill symbolsStroke",
  "d3-hierarchy":
    "Node cluster hierarchy pack packEnclose packSiblings partition stratify tree treemap treemapBinary treemapDice treemapResquarify treemapSlice treemapSliceDice treemapSquarify",
  "d3-force":
    "forceCenter forceCollide forceLink forceManyBody forceRadial forceSimulation forceX forceY",
  "@nivo/bar":
    "Bar BarCanvas BarItem BarTooltip BarTotals ResponsiveBar ResponsiveBarCanvas canvasDefaultProps commonDefaultProps svgDefaultProps",
  "@nivo/boxplot": "BoxPlot BoxPlotItem ResponsiveBoxPlot defaultProps svgDefaultProps",
  "@nivo/bullet": "Bullet BulletItem ResponsiveBullet defaultProps",
  "@nivo/bump":
    "AreaBump Bump ResponsiveAreaBump ResponsiveBump areaBumpSvgDefaultProps bumpSvgDefaultProps isBumpPoint isComputedBumpSerie useAreaBump useAreaBumpSerieHandlers useAreaBumpSeriesLabels useBump useBumpPointHandlers useBumpSerieHandlers useBumpSeriesLabels",
  "@nivo/calendar":
    "ARRAY_OF_WEEKDAYS Calendar CalendarCanvas ResponsiveCalendar ResponsiveCalendarCanvas ResponsiveTimeRange TimeRange bindDaysData calendarCanvasDefaultProps calendarDefaultProps computeCellPositions computeCellSize computeDomain computeLayout computeMonthLegendPositions computeMonthLegends computeTotalDays computeWeekdays computeYearLegendPositions getDayIndex getFirstWeekdayIndex timeRangeDefaultProps useCalendarLayout useColorScale useDays useMonthLegends useYearLegends",
  "@nivo/chord":
    "Chord ChordCanvas ResponsiveChord ResponsiveChordCanvas canvasDefaultProps commonDefaultProps computeArcPath computeChordArcsAndRibbons computeChordGenerators computeChordLayout computeRibbonPath svgDefaultProps useChord useChordArcsAndRibbons useChordGenerators useChordLayout useChordSelection useCustomLayerProps",
  "@nivo/circle-packing":
    "CirclePacking CirclePackingCanvas CirclePackingHtml InnerCirclePackingHtml ResponsiveCirclePacking ResponsiveCirclePackingCanvas ResponsiveCirclePackingHtml canvasDefaultProps commonDefaultProps htmlDefaultProps svgDefaultProps useCirclePacking useCirclePackingLabels useCirclePackingLayerContext useCirclePackingZoom useMouseCircleDetection useNodeMouseHandlers",
  "@nivo/funnel":
    "Funnel ResponsiveFunnel computePartsHandlers computeScales computeSeparators computeShapeGenerators getSizeGenerator svgDefaultProps useFunnel useFunnelAnnotations useSize",
  "@nivo/geo":
    "Choropleth ChoroplethCanvas ChoroplethCanvasDefaultProps ChoroplethDefaultProps GeoMap GeoMapCanvas GeoMapCanvasDefaultProps GeoMapDefaultProps ResponsiveChoropleth ResponsiveChoroplethCanvas ResponsiveGeoMap ResponsiveGeoMapCanvas projectionById useChoropleth useGeoMap",
  "@nivo/heatmap":
    "HeatMap HeatMapCanvas ResponsiveHeatMap ResponsiveHeatMapCanvas canvasDefaultProps commonDefaultProps computeCells computeLayout computeSizeScale getCellAnnotationDimensions getCellAnnotationPosition svgDefaultProps useCellAnnotations useComputeCells useHeatMap",
  "@nivo/icicle":
    "Icicle IcicleHtml IcicleNodes IcicleTooltip ResponsiveIcicle ResponsiveIcicleHtml commonDefaultProps htmlDefaultProps svgDefaultProps useIcicle useIcicleContext useIcicleNav useMemoizeChartContext",
  "@nivo/line":
    "LINE_UNIQUE_ID_PREFIX Line LineCanvas ResponsiveLine ResponsiveLineCanvas canvasDefaultProps commonDefaultProps isPoint isSliceData svgDefaultProps useAreaGenerator useLine useLineGenerator useSlices",
  "@nivo/marimekko": "Marimekko ResponsiveMarimekko commonDefaultProps offsetById svgDefaultProps",
  "@nivo/network":
    "Network NetworkCanvas ResponsiveNetwork ResponsiveNetworkCanvas canvasDefaultProps commonDefaultProps svgDefaultProps useNetwork useNodeAnnotations",
  "@nivo/parallel-coordinates":
    "InnerParallelCoordinatesCanvas ParallelCoordinates ParallelCoordinatesCanvas ResponsiveParallelCoordinates ResponsiveParallelCoordinatesCanvas canvasDefaultProps commonDefaultProps svgDefaultProps",
  "@nivo/pie":
    "Pie PieCanvas ResponsivePie ResponsivePieCanvas defaultProps useNormalizedData usePie usePieArcs usePieFromBox usePieLayerContext",
  "@nivo/polar-bar": "PolarBar ResponsivePolarBar defaultProps svgDefaultProps",
  "@nivo/radar": "Radar RadarDots ResponsiveRadar svgDefaultProps",
  "@nivo/radial-bar": "RadialBar ResponsiveRadialBar commonDefaultProps svgDefaultProps",
  "@nivo/sankey":
    "ResponsiveSankey Sankey sankeyAlignmentFromProp sankeyAlignmentPropKeys sankeyAlignmentPropMapping svgDefaultProps",
  "@nivo/scatterplot":
    "ResponsiveScatterPlot ResponsiveScatterPlotCanvas ScatterPlot ScatterPlotCanvas canvasDefaultProps commonDefaultProps svgDefaultProps useScatterPlot useScatterPlotAnnotations",
  "@nivo/stream": "ResponsiveStream Stream defaultProps svgDefaultProps",
  "@nivo/sunburst": "ResponsiveSunburst Sunburst defaultProps useSunburst useSunburstLayerContext",
  "@nivo/swarmplot":
    "InnerSwarmPlotCanvas ResponsiveSwarmPlot ResponsiveSwarmPlotCanvas SwarmPlot SwarmPlotCanvas SwarmPlotTooltip computeForces computeNodes computeOrdinalScale computeValueScale defaultProps getSizeGenerator renderCircleDefault useBorderWidth useForces useNodeMouseHandlers useOrdinalScale useSwarmPlot useSwarmPlotAnnotations useSwarmPlotLayerContext useValueScale",
  "@nivo/tree":
    "ResponsiveTree ResponsiveTreeCanvas Tree TreeCanvas canvasDefaultProps commonDefaultProps svgDefaultProps useLabels useLinkMouseEventHandlers useNodeMouseEventHandlers useRoot useTree",
  "@nivo/treemap":
    "ResponsiveTreeMap ResponsiveTreeMapCanvas ResponsiveTreeMapHtml TreeMap TreeMapCanvas TreeMapHtml canvasDefaultProps commonDefaultProps htmlDefaultProps htmlLabelTransform htmlNodeTransform htmlParentLabelTransform svgDefaultProps svgLabelTransform svgNodeTransform tileByType",
  "@nivo/voronoi":
    "Mesh ResponsiveVoronoi Voronoi computeMesh computeMeshPoints defaultVoronoiProps renderDebugToCanvas renderDelaunayPointsToCanvas renderVoronoiCellToCanvas renderVoronoiToCanvas useMesh useMeshEvents useVoronoi useVoronoiLayerContext useVoronoiMesh",
  "@nivo/waffle":
    "ResponsiveWaffle ResponsiveWaffleCanvas ResponsiveWaffleHtml Waffle WaffleCanvas WaffleHtml canvasDefaultProps commonDefaultProps htmlDefaultProps isDataCell svgDefaultProps",
} satisfies Record<keyof typeof CANVAS_LIBRARY_VERSIONS, string>;
