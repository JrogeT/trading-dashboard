import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Signal } from '../models/signal.model';

@Injectable({ providedIn: 'root' })
export class SignalsService {
  private supabaseService = inject(SupabaseService);

  async getSignals(): Promise<Signal[]> {
    const { data, error } = await this.supabaseService.supabase
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      throw error;
    }

    return data as Signal[];
  }

  async getActiveTrades(): Promise<Signal[]> {
    const { data, error } = await this.supabaseService.supabase
      .from('signals')
      .select('*')
      .eq('status', 'Trade Active')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data as Signal[];
  }
}
