import { create } from 'zustand';
import type { Project, Engineering, Application } from '../types/server';
import {
  fetchProjects, createProject, updateProject, deleteProject,
  fetchEngineerings, createEngineering, updateEngineering, deleteEngineering,
  fetchApplications, createApplication, updateApplication, deleteApplication,
} from '../services/serverService';

interface ProjectState {
  projects: Project[];
  engineerings: Engineering[];
  applications: Application[];
  loading: boolean;

  loadProjects: () => Promise<void>;
  loadEngineerings: (projectId?: string) => Promise<void>;
  loadApplications: (engineeringId?: string) => Promise<void>;

  addProject: (name: string, shortName?: string) => Promise<string>;
  editProject: (id: string, partial: any) => Promise<void>;
  removeProject: (id: string) => Promise<void>;

  addEngineering: (projectId: string, name: string, shortName?: string) => Promise<string>;
  editEngineering: (id: string, partial: any) => Promise<void>;
  removeEngineering: (id: string) => Promise<void>;

  addApplication: (engineeringId: string, name: string, shortName?: string) => Promise<string>;
  editApplication: (id: string, partial: any) => Promise<void>;
  removeApplication: (id: string) => Promise<void>;

  getEngineeringsByProject: (projectId: string) => Engineering[];
  getApplicationsByEngineering: (engineeringId: string) => Application[];
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  engineerings: [],
  applications: [],
  loading: false,

  loadProjects: async () => {
    set({ loading: true });
    try {
      const projects = await fetchProjects();
      set({ projects, loading: false });
    } catch (e) {
      console.error('加载项目列表失败:', e);
      set({ loading: false });
    }
  },

  loadEngineerings: async (projectId) => {
    try {
      const engineerings = await fetchEngineerings(projectId);
      if (projectId) {
        set({ engineerings: [...get().engineerings.filter(e => e.projectId !== projectId), ...engineerings.map(mapEng)] });
      } else {
        set({ engineerings: engineerings.map(mapEng) });
      }
    } catch (e) { console.error('加载工程列表失败:', e); }
  },

  loadApplications: async (engineeringId) => {
    try {
      const applications = await fetchApplications(engineeringId);
      if (engineeringId) {
        set({ applications: [...get().applications.filter(a => a.engineeringId !== engineeringId), ...applications.map(mapApp)] });
      } else {
        set({ applications: applications.map(mapApp) });
      }
    } catch (e) { console.error('加载应用列表失败:', e); }
  },

  addProject: async (name, shortName?) => {
    const p = await createProject(name, shortName);
    set({ projects: [...get().projects, { id: p.id, name: p.name, shortName: p.short_name || '', sortOrder: 0, createdAt: p.created_at, updatedAt: p.updated_at }] });
    return p.id;
  },
  editProject: async (id, partial) => {
    await updateProject(id, partial);
    await get().loadProjects();
  },
  removeProject: async (id) => {
    await deleteProject(id);
    set({ projects: get().projects.filter(p => p.id !== id) });
  },

  addEngineering: async (projectId, name, shortName?) => {
    const e = await createEngineering(projectId, name, shortName);
    set({ engineerings: [...get().engineerings, { id: e.id, projectId: e.project_id, name: e.name, shortName: e.short_name || '', sortOrder: 0, createdAt: e.created_at, updatedAt: e.updated_at }] });
    return e.id;
  },
  editEngineering: async (id, partial) => {
    await updateEngineering(id, partial);
    await get().loadEngineerings();
  },
  removeEngineering: async (id) => {
    await deleteEngineering(id);
    set({ engineerings: get().engineerings.filter(e => e.id !== id) });
  },

  addApplication: async (engineeringId, name, shortName?) => {
    const a = await createApplication(engineeringId, name, shortName);
    set({ applications: [...get().applications, { id: a.id, engineeringId: a.engineering_id, name: a.name, shortName: a.short_name || '', sortOrder: 0, createdAt: a.created_at, updatedAt: a.updated_at }] });
    return a.id;
  },
  editApplication: async (id, partial) => {
    await updateApplication(id, partial);
    await get().loadApplications();
  },
  removeApplication: async (id) => {
    await deleteApplication(id);
    set({ applications: get().applications.filter(a => a.id !== id) });
  },

  getEngineeringsByProject: (projectId) => get().engineerings.filter(e => e.projectId === projectId),
  getApplicationsByEngineering: (engineeringId) => get().applications.filter(a => a.engineeringId === engineeringId),
}));

function mapEng(e: any): Engineering {
  return { id: e.id, projectId: e.project_id, name: e.name, shortName: e.short_name || '', sortOrder: e.sort_order ?? 0, createdAt: e.created_at, updatedAt: e.updated_at };
}

function mapApp(a: any): Application {
  return { id: a.id, engineeringId: a.engineering_id, name: a.name, shortName: a.short_name || '', sortOrder: a.sort_order ?? 0, createdAt: a.created_at, updatedAt: a.updated_at };
}
