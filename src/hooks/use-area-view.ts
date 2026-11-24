import { useContext } from 'react';
import { areaViewContext } from '@/context/area-view-context/area-view-context';

/** Area navigation state (LuxDBDiagram): the open Area, back history, focus requests. */
export const useAreaView = () => useContext(areaViewContext);
