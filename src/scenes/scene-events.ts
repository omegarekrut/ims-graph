import type { GraphId, SceneGraphEvent, SceneGraphEventType } from '../core/contracts';

export interface SceneEventFilter {
  type?: SceneGraphEventType;
  graphId?: GraphId | null;
  outputKey?: string;
}

type SceneEventListener = (event: SceneGraphEvent) => void;

function matchesFilter(event: SceneGraphEvent, filter: SceneEventFilter): boolean {
  const matchesType = !filter.type || filter.type === event.type;
  const matchesGraph = typeof filter.graphId === 'undefined' || filter.graphId === event.graphId;
  const matchesOutput =
    typeof filter.outputKey === 'undefined' || filter.outputKey === event.outputKey;
  return matchesType && matchesGraph && matchesOutput;
}

interface SceneEventSubscription {
  filter: SceneEventFilter;
  listener: SceneEventListener;
}

export class SceneEventBus {
  private readonly subscriptions = new Set<SceneEventSubscription>();

  publish(event: SceneGraphEvent): void {
    this.subscriptions.forEach((subscription) => {
      if (!matchesFilter(event, subscription.filter)) {
        return;
      }
      subscription.listener(event);
    });
  }

  subscribe(filter: SceneEventFilter, listener: SceneEventListener): () => void {
    const subscription: SceneEventSubscription = {
      filter,
      listener,
    };
    this.subscriptions.add(subscription);

    return () => {
      this.subscriptions.delete(subscription);
    };
  }
}
