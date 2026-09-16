// @ts-nocheck
import React, { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TablePagination from '@mui/material/TablePagination';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import LoginIcon from '@mui/icons-material/Login';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ViewCarouselIcon from '@mui/icons-material/ViewCarousel';
import ReorderIcon from '@mui/icons-material/Reorder';
import { adminAPI } from '../services/api';
import type { AdminLog } from '../types';

interface ActionConfig {
  label: string;
  color: string;
  icon: React.ReactNode;
}

const actionConfig: Record<string, ActionConfig> = {
  LOGIN: { label: 'Login', color: '#22c55e', icon: <LoginIcon fontSize="small" /> },
  CREATE_CONTENT: { label: 'Nuovo Contenuto', color: '#3b82f6', icon: <AddCircleIcon fontSize="small" /> },
  UPDATE_CONTENT: { label: 'Modifica Contenuto', color: '#f59e0b', icon: <EditIcon fontSize="small" /> },
  DELETE_CONTENT: { label: 'Eliminazione', color: '#ef4444', icon: <DeleteIcon fontSize="small" /> },
  UPDATE_HERO: { label: 'Modifica Hero', color: '#8b5cf6', icon: <ViewCarouselIcon fontSize="small" /> },
  UPDATE_SECTION: { label: 'Modifica Sezione', color: '#06b6d4', icon: <ReorderIcon fontSize="small" /> },
  REORDER_SECTIONS: { label: 'Riordino Sezioni', color: '#06b6d4', icon: <ReorderIcon fontSize="small" /> },
};

const LogsPage: React.FC = () => {
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState<string>('');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: { action?: string; page: number; limit: number } = {
        page: page + 1,
        limit: rowsPerPage,
      };
      if (actionFilter) params.action = actionFilter;

      const data = await adminAPI.getLogs(params);
      setLogs(data.items);
      setTotal(data.total);
    } catch (error) {
      console.error('Errore caricamento log:', error);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, actionFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getActionDisplay = (action: string): ActionConfig => {
    return actionConfig[action] || { label: action, color: '#6b7280', icon: null };
  };

  return (
    <Box data-testid="logs-page">
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 4, color: '#fff' }}>
        Log Attività
      </Typography>

      {/* Filter */}
      <Box sx={{ mb: 3 }}>
        <FormControl sx={{ minWidth: 220 }}>
          <InputLabel>Filtra per Azione</InputLabel>
          <Select
            value={actionFilter}
            label="Filtra per Azione"
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(0);
            }}
            data-testid="logs-filter-select"
          >
            <MenuItem value="">Tutte le azioni</MenuItem>
            {Object.entries(actionConfig).map(([key, config]) => (
              <MenuItem key={key} value={key}>
                {config.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* Table */}
      <Paper
        elevation={0}
        sx={{
          bgcolor: 'rgba(20, 20, 20, 0.8)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.3)' }}>
                <TableCell sx={{ color: 'grey.500', borderColor: 'rgba(255,255,255,0.06)', fontWeight: 600 }}>
                  Data/Ora
                </TableCell>
                <TableCell sx={{ color: 'grey.500', borderColor: 'rgba(255,255,255,0.06)', fontWeight: 600 }}>
                  Azione
                </TableCell>
                <TableCell sx={{ color: 'grey.500', borderColor: 'rgba(255,255,255,0.06)', fontWeight: 600 }}>
                  Contenuto ID
                </TableCell>
                <TableCell sx={{ color: 'grey.500', borderColor: 'rgba(255,255,255,0.06)', fontWeight: 600 }}>
                  Dettagli
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 8, borderColor: 'rgba(255,255,255,0.06)' }}>
                    <CircularProgress size={40} sx={{ color: '#e50914' }} />
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    align="center"
                    sx={{ py: 8, borderColor: 'rgba(255,255,255,0.06)', color: 'grey.500' }}
                  >
                    Nessun log trovato
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log, index) => {
                  const actionDisplay = getActionDisplay(log.action);
                  return (
                    <TableRow
                      key={`${log.timestamp}-${index}`}
                      hover
                      sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}
                    >
                      <TableCell
                        sx={{ borderColor: 'rgba(255,255,255,0.06)', color: 'grey.400', fontSize: 13 }}
                      >
                        {formatDate(log.timestamp)}
                      </TableCell>
                      <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        <Chip
                          size="small"
                          icon={actionDisplay.icon as React.ReactElement}
                          label={actionDisplay.label}
                          sx={{
                            bgcolor: `${actionDisplay.color}15`,
                            color: actionDisplay.color,
                            fontWeight: 500,
                            '& .MuiChip-icon': { color: actionDisplay.color },
                          }}
                        />
                      </TableCell>
                      <TableCell
                        sx={{
                          borderColor: 'rgba(255,255,255,0.06)',
                          color: 'grey.400',
                          fontFamily: 'monospace',
                        }}
                      >
                        {log.contentId || '-'}
                      </TableCell>
                      <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)', color: 'grey.500' }}>
                        {log.metadata && Object.keys(log.metadata).length > 0 ? (
                          <Typography
                            variant="caption"
                            component="pre"
                            sx={{
                              m: 0,
                              whiteSpace: 'pre-wrap',
                              fontFamily: 'monospace',
                              fontSize: 11,
                              maxWidth: 300,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {JSON.stringify(log.metadata, null, 2)}
                          </Typography>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
          labelRowsPerPage="Righe:"
          sx={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: 'grey.400' }}
        />
      </Paper>
    </Box>
  );
};

export default LogsPage;
