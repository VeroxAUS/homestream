import type { StreamHdr, StreamResolution, StreamVideoCodec } from '@homestream/shared';

export interface FilenameCase {
  filename: string;
  resolution: StreamResolution;
  videoCodec: StreamVideoCodec;
  hdr: StreamHdr;
  source: string;
  audio: string;
  languages?: string[];
}

const c = (
  filename: string,
  resolution: StreamResolution,
  videoCodec: StreamVideoCodec,
  hdr: StreamHdr,
  source: string,
  audio: string,
  languages?: string[],
): FilenameCase => ({ filename, resolution, videoCodec, hdr, source, audio, languages });

/** Release names recorded from real gateway lookups (titles only, no URLs or tokens), plus a few synthetic edge cases. */
export const FILENAME_CASES: FilenameCase[] = [
  c('The.Shawshank.Redemption.1994.UHD.BluRay.2160p.DTS-HD.MA.5.1.DV.HEVC.HYBRID.REMUX-FraMeSToR.mkv', '2160p', 'hevc', 'dv', 'Remux', 'DTS-HD MA 5.1'),
  c('The.Shawshank.Redemption.1994.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC.DTS-HD.MA.5.1-SyncTeam.mkv', '2160p', 'hevc', 'dv', 'Remux', 'DTS-HD MA 5.1'),
  c('The.Shawshank.Redemption.1994.2160p.UHD.Hybrid.Blu-ray.Remux.DV.HDR.HEVC.DTS-HD.MA.5.1-OzONE.mkv', '2160p', 'hevc', 'dv', 'Remux', 'DTS-HD MA 5.1'),
  c('The Shawshank Redemption (1994) UHD BDRemux 2160p HDR, Dolby Vision [Hybrid].mkv', '2160p', 'other', 'dv', 'Remux', 'Unknown', []),
  c('The Shawshank Redemption 1994 2160p UHD BluRay DTS-HD MA 5.1 DV HDR x265-HiDt.mkv', '2160p', 'hevc', 'dv', 'BluRay', 'DTS-HD MA 5.1'),
  c('The Shawshank Redemption 1994 2160p UHD BDRip HEVC 10bit DV HDR DTS-HD.MA.5.1 MUSHR00M.mkv', '2160p', 'hevc', 'dv', 'BluRay', 'DTS-HD MA 5.1'),
  c('The Shawshank Redemption 1994 2160p UHD BluRay DTS-HD MA 5 1 HDR x265-W4NK3R.mkv', '2160p', 'hevc', 'hdr10', 'BluRay', 'DTS-HD MA 5.1'),
  c('The.Shawshank.Redemption.1994.UHD.BDRip.1440p.NNMClub.mkv', 'unknown', 'other', 'unknown', 'BluRay', 'Unknown'),
  c('The Shawshank Redemption (1994) PROPER BluRay 1080p DTS-HD MA 5.1 AVC REMUX - FraMeSToR.mkv', '1080p', 'h264', 'sdr', 'Remux', 'DTS-HD MA 5.1'),
  c('The Shawshank Redemption (1994) REMUX (AVC DTSHD-MA) - FiNAL.mkv', 'unknown', 'h264', 'unknown', 'Remux', 'DTS-HD MA'),
  c('Побег из Шоушенка / The Shawshank Redemption (1994) BDRemux 1080p | D P P2 A', '1080p', 'other', 'sdr', 'Remux', 'Unknown', ['rus']),
  c('The.Shawshank.Redemption.1994.2160p.MA.WEB-DL.DTS-HD.MA.5.1.DV.HDR.H.265-TheFarm.mkv', '2160p', 'hevc', 'dv', 'WEB-DL', 'DTS-HD MA 5.1'),
  c('The Shawshank Redemption (1994) UHD WEB-DL 4K 2160p H.265 HEVC HDR 10 3xUkr Eng Sub Ukr Eng Multilang[Hurtom].mkv', '2160p', 'hevc', 'hdr10', 'WEB-DL', 'Unknown', ['ukr', 'eng']),
  c('The.Shawshank.Redemption.1994.MULTi.HDR.DV.2160p.WEB.H265-FW.mkv', '2160p', 'hevc', 'dv', 'WEB-DL', 'Unknown'),
  c('The.Shawshank.Redemption.1994.1080p.UHD.BluRay.DD+5.1.DoVi.x265-SA89.mkv', '1080p', 'hevc', 'dv', 'BluRay', 'EAC3 5.1'),
  c('The.Shawshank.Redemption.1994.1080p.BluRay.DD.5.1.x264-c0kE.mkv', '1080p', 'h264', 'sdr', 'BluRay', 'AC3 5.1'),
  c('The.Shawshank.Redemption.1994.REMASTERED.1080p.BluRay.23xRus.2xBel.3xUkr.Eng.c0kE.mkv', '1080p', 'other', 'sdr', 'BluRay', 'Unknown', ['rus', 'bel', 'ukr', 'eng']),
  c('The Shawshank Redemption 1994 1080p MA WEB-DL H264 SDR DDP 5 1 English HONE.mkv', '1080p', 'h264', 'sdr', 'WEB-DL', 'EAC3 5.1', ['eng']),
  c('The.Shawshank.Redemption.1994.1080p.NF.WEB-DL.DDP5.1.x264-OzONE.mkv', '1080p', 'h264', 'sdr', 'WEB-DL', 'EAC3 5.1'),
  c('The.Shawshank.Redemption.1994.1080p.NF.WEB-DL.H264-ETRG[EtHD].mkv', '1080p', 'h264', 'sdr', 'WEB-DL', 'Unknown'),
  c('The.Shawshank.Redemption.1994.1080p.WEBRip.h264.BGAUDIO-L7.mp4', '1080p', 'h264', 'sdr', 'WEBRip', 'Unknown'),
  c('The.Shawshank.Redemption.1994.2160p.UHD.BluRay.REMUX.HDR.HEVC.DTS-HD.MA.5.1-SYS.mkv', '2160p', 'hevc', 'hdr10', 'Remux', 'DTS-HD MA 5.1'),
  c('Побег из Шоушенка 1994г. BDRip 1080p.mkv', '1080p', 'other', 'sdr', 'BluRay', 'Unknown', ['rus']),
  c('The.Shawshank Redemption.1994.BD.Rip.720p.h264.AC3-5.1.Rus.Eng.mkv', '720p', 'h264', 'sdr', 'BluRay', 'AC3 5.1', ['rus', 'eng']),
  c('Побег из Шоушенка / The Shawshank Redemption (1994) BDRip-AVC от R.G. HD-Films | 60 fps', 'unknown', 'h264', 'unknown', 'BluRay', 'Unknown', ['rus']),
  c('The.Shawshank.Redemption.1994.720p.BRRip.XviD.AC3-ViSiON [NO-RAR] - [ www.torrentday.com ]', '720p', 'other', 'sdr', 'BluRay', 'AC3'),
  c('The Shawshank Redemption 1994 720p BluRay x264 DD5 1-REKD', '720p', 'h264', 'sdr', 'BluRay', 'AC3 5.1'),
  c('Побег из Шоушенка.1994.avi', 'unknown', 'other', 'unknown', 'Unknown', 'Unknown', ['rus']),
  c('The.Shawshank.Redemption.1994.BDRip.AVC.mkv', 'unknown', 'h264', 'unknown', 'BluRay', 'Unknown'),
  c('The Shawshank Redemption,1994,BRRip,Sub Arabic-ToZoon.AVI', 'unknown', 'other', 'unknown', 'BluRay', 'Unknown', ['ara']),
  c('Dune.Part.Two.2024.UHD.BluRay.2160p.TrueHD.Atmos.7.1.DV.HEVC.REMUX-FraMeSToR.DUAL-ASM.mkv', '2160p', 'hevc', 'dv', 'Remux', 'TrueHD Atmos 7.1'),
  c('Dune.Part.Two.2024.MULTi.VFF.2160p.UHD.BluRay.REMUX.HYBRID.DV.HDR10Plus.HEVC.TrueHD.7.1.Atmos-OPTIMUM.mkv', '2160p', 'hevc', 'dv', 'Remux', 'TrueHD Atmos 7.1', ['fre']),
  c('Dune.Part.Two.2024.2160p.UHD.BluRay.HDR.DV.TrueHD.7.1.x265-SPHD.mkv', '2160p', 'hevc', 'dv', 'BluRay', 'TrueHD 7.1'),
  c('Dune.Part.Two.2024.MULTi.TRUEFRENCH.2160p.UHD.BluRay.x265-PiKES.mkv', '2160p', 'hevc', 'unknown', 'BluRay', 'Unknown', ['fre']),
  c('Dune.Parte.Due.2024.iTA-ENG.Bluray.2160p.HEVC.HDR.x265-CYBER.mkv', '2160p', 'hevc', 'hdr10', 'BluRay', 'Unknown', ['ita', 'eng']),
  c('Dune.Part.Two.2024.Eng.Fre.Ger.Ita.Spa.Cze.Pol.Jpn.1080p.BluRay.Remux.AVC.Atmos-SGF.mkv', '1080p', 'h264', 'sdr', 'Remux', 'Atmos', ['eng', 'fre', 'ger', 'ita', 'spa', 'cze', 'pol', 'jpn']),
  c('Dune Part Two 2024 NORDiC 1080p REMUX BluRay AVC DTS-HD MA TrueHD 7 1 Atmos-NorTekst.mkv', '1080p', 'h264', 'sdr', 'Remux', 'TrueHD Atmos 7.1'),
  c('Dune.Part.Two.2024.2160p.WEB-DL.DV.HDR.[Hindi.DDP5.1_English.DDPA5.1].H.265_(FLUX -Ionicboy).mkv', '2160p', 'hevc', 'dv', 'WEB-DL', 'EAC3 Atmos 5.1', ['hin', 'eng']),
  c('Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv', '2160p', 'hevc', 'dv', 'WEB-DL', 'EAC3 Atmos 5.1'),
  c('Dune.Part.Two.2024.2160p.AMZN.WEB-DL.HEVC.MULTi.PL.TrueHD.7.1.Atmos-ETeam-vantablack.mkv', '2160p', 'hevc', 'unknown', 'WEB-DL', 'TrueHD Atmos 7.1'),
  c('Dune.Part.Two.2024.MULTI.VF2.2160p.WEBRip.DV.HDR10+.DDP.5.1.Atmos.x265.HEVC-ESPER.mkv', '2160p', 'hevc', 'dv', 'WEBRip', 'EAC3 Atmos 5.1', ['fre']),
  c('Dune Part Two 2024 BluRay 1080p HEVC HDR 8ch-CAPTCHA.mkv', '1080p', 'hevc', 'hdr10', 'BluRay', 'Unknown'),
  c('[ Torrent911.wf ] Dune.Part.Two.2024.MULTi.1080p.BluRay.x264-LYPSG.mkv', '1080p', 'h264', 'sdr', 'BluRay', 'Unknown'),
  c('Dune Part Two (2024) English 1080p WEBRip - 2400 MB -  AAC 2.0 x264 ESubs-SHADOW.mkv', '1080p', 'h264', 'sdr', 'WEBRip', 'AAC 2.0', ['eng']),
  c('Dune.Part.Two.2024.1080p.WEBRip.Dublado.mkv', '1080p', 'other', 'sdr', 'WEBRip', 'Unknown', ['por']),
  c('Dune Part Two 2024  1080p Web-DL  HEVC  x265 10-Bit DDP5.1 Subs KINGDOM RG.mkv', '1080p', 'hevc', 'sdr', 'WEB-DL', 'EAC3 5.1'),
  c('[superseed.byethost7.com] Dune.Part.Two.2024.MULTi.1080p.AMZN.WEB-DL.H264.DDP5.1.Atmos-K83.mkv.ts', '1080p', 'h264', 'sdr', 'WEB-DL', 'EAC3 Atmos 5.1'),
  c('Dune.Part.Two.2024.1080p.AMZN.WEB-DL.DDP5.1.Atmos.H.264-FLUX-RGB.mkv', '1080p', 'h264', 'sdr', 'WEB-DL', 'EAC3 Atmos 5.1'),
  c('Dune: Part Two [2024, WEB-DL] MVO (Jaskier)', 'unknown', 'other', 'unknown', 'WEB-DL', 'Unknown'),
  // Synthetic edge cases
  c('Some.Movie.2020.2160p.WEB-DL.HDR10+.x265-GRP.mkv', '2160p', 'hevc', 'hdr10+', 'WEB-DL', 'Unknown'),
  c('Some.Movie.2020.2160p.HDR10.HEVC.AAC.2.0.mkv', '2160p', 'hevc', 'hdr10', 'Unknown', 'AAC 2.0'),
  c('Some.Show.S01E01.1080p.HDTV.x264.AAC-GRP.mkv', '1080p', 'h264', 'sdr', 'HDTV', 'AAC'),
  c('Some.Show.S01E01.720p.HDTV.x264-GRP.mkv', '720p', 'h264', 'sdr', 'HDTV', 'Unknown'),
  c('Some.Movie.2020.2160p.HLG.AV1.OPUS.WEB-DL.mkv', '2160p', 'av1', 'hlg', 'WEB-DL', 'Opus'),
  c('Some.Movie.2020.4K.UHD.BluRay.x265.mkv', '2160p', 'hevc', 'unknown', 'BluRay', 'Unknown'),
  c('Some.Movie.2020.576p.DVDRip.XviD.mkv', '480p', 'other', 'sdr', 'DVD', 'Unknown'),
  c('Some.Movie.2020.480p.HDRip.x264.mkv', '480p', 'h264', 'sdr', 'Unknown', 'Unknown'),
  c('Some.Movie.2020.1080p.BluRay.x264.E-AC-3.5.1.mkv', '1080p', 'h264', 'sdr', 'BluRay', 'EAC3 5.1'),
  c('Some.Movie.2020.1080p.BluRay.x264.DTS-X.7.1.mkv', '1080p', 'h264', 'sdr', 'BluRay', 'DTS:X 7.1'),
  c('Some.Movie.2020.1080p.BluRay.x264.DTS-HD.MA.mkv', '1080p', 'h264', 'sdr', 'BluRay', 'DTS-HD MA'),
  c('', 'unknown', 'other', 'unknown', 'Unknown', 'Unknown', []),
];

export const CACHED_NAME = '   4K    \u26A1 |   \u2329Remux\u232A     |   \u2605\u2605\u2605';
export const UNCACHED_NAME = '1080P    \u23F3 |   \u2329Bluray\u232A';
