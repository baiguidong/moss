export type VisualizationSelection = {
  kind: 'element' | 'text' | 'region'; pageNumber?: number; selector: string; text: string; nearbyText: string;
  rect: { x: number; y: number; width: number; height: number };
};
export type VisualizationAnnotation = {
  id: string; resourceUri: string; comment: string; selection: VisualizationSelection; state: unknown;
};
export function normalizeVisualizationSelection(value: unknown): VisualizationSelection;
export function normalizeVisualizationAnnotation(value: unknown): VisualizationAnnotation;
