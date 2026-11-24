import { useContext } from 'react';
import { AccentContext } from '@/context/accent-context/accent-context';

/** The chosen accent colour and a setter (LuxDBDiagram). */
export const useAccent = () => useContext(AccentContext);
